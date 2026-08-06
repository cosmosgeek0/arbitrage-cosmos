import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  BookOpen,
  Braces,
  ChevronDown,
  FileCheck2,
  FileText,
  RotateCcw,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import {
  RESEARCH_LAB_ARTIFACT_PROVENANCE,
  type ResearchLabArtifact,
} from '../../data/researchLabArtifacts';
import {
  readableResearchLabBytes,
  researchLabGateRows,
  researchLabParameterRows,
  researchLabSealRows,
  researchLabTopLevelRows,
  researchLabTrialTable,
  type ResearchLabDataTable,
  type ResearchLabGateRow,
  type ResearchLabKeyValue,
} from '../../data/researchLabEvidence';
import {
  artifactRoleLabel,
  artifactsForRequestFamily,
  loadResearchArtifact,
  preferredResearchArtifact,
  resolveArtifactRequest,
  type ArtifactRequest,
  type LoadedResearchArtifact,
} from './researchLabArtifactClient';
import './ResearchLabArtifactWorkbench.css';

export type { ArtifactRequest } from './researchLabArtifactClient';

export type ResearchLabArtifactView = 'RAW' | 'STRUCTURED';

export type ResearchLabArtifactWorkbenchProps = Readonly<{
  family: string;
  artifacts: readonly ResearchLabArtifact[];
  requestedArtifact?: ArtifactRequest | null;
  initialView?: ResearchLabArtifactView;
  className?: string;
}>;

type BoundArtifactLoadState =
  | Readonly<{
    status: 'IDLE';
    artifactPath: null;
    artifactSha256: null;
    loaded: null;
    error: null;
  }>
  | Readonly<{
    status: 'LOADING';
    artifactPath: string;
    artifactSha256: string;
    loaded: null;
    error: null;
  }>
  | Readonly<{
    status: 'READY';
    artifactPath: string;
    artifactSha256: string;
    loaded: LoadedResearchArtifact;
    error: null;
  }>
  | Readonly<{
    status: 'INVALID';
    artifactPath: string;
    artifactSha256: string;
    loaded: null;
    error: string;
  }>;

const EMPTY_LOAD_STATE: BoundArtifactLoadState = Object.freeze({
  status: 'IDLE',
  artifactPath: null,
  artifactSha256: null,
  loaded: null,
  error: null,
});

const VIEW_TABS: readonly Readonly<{
  id: ResearchLabArtifactView;
  label: string;
}>[] = Object.freeze([
  { id: 'STRUCTURED', label: 'Structured' },
  { id: 'RAW', label: 'Raw' },
]);

function artifactIcon(artifact: ResearchLabArtifact, size = 18): ReactNode {
  if (artifact.role === 'README') return <BookOpen size={size} aria-hidden="true" />;
  if (artifact.role === 'PROTOCOL') return <ScrollText size={size} aria-hidden="true" />;
  if (artifact.role === 'FREEZE') return <FileCheck2 size={size} aria-hidden="true" />;
  if (artifact.format === 'JSON') return <Braces size={size} aria-hidden="true" />;
  return <FileText size={size} aria-hidden="true" />;
}

function gateStatusTone(status: string): 'FAIL' | 'PASS' | 'RECORDED' {
  if (/^(?:PASS|TRUE)$/iu.test(status)) return 'PASS';
  if (/(?:FAIL|FALSE|NO_GO|REJECT)/iu.test(status)) return 'FAIL';
  return 'RECORDED';
}

function recordedValueKind(value: string): string {
  if (value === 'NULL_RECORDED') return 'null';
  if (value === 'NONE_RECORDED') return 'missing';
  if (value === 'EMPTY_STRING_RECORDED') return 'empty-string';
  if (value === 'EMPTY_ARRAY_RECORDED') return 'empty-array';
  if (value === 'EMPTY_OBJECT_RECORDED') return 'empty-object';
  if (value === 'true' || value === 'false') return 'boolean';
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) return value === '0' ? 'zero' : 'number';
  return 'text';
}

function EvidenceSection({
  eyebrow,
  title,
  detail,
  children,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <section className="rlaw-record-section">
      <header className="rlaw-section-head">
        <div>
          <span>{eyebrow}</span>
          <h5>{title}</h5>
        </div>
        {detail ? <small>{detail}</small> : null}
      </header>
      {children}
    </section>
  );
}

function KeyValueTable({
  caption,
  rows,
  keyLabel = 'Recorded Path',
}: {
  caption: string;
  rows: readonly ResearchLabKeyValue[];
  keyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="rlaw-record-empty">NONE_RECORDED</p>;
  }
  return (
    <div className="rlaw-table-scroll" tabIndex={0} aria-label={caption}>
      <table className="rlaw-evidence-table rlaw-key-value-table">
        <caption className="rlaw-visually-hidden">{caption}</caption>
        <thead>
          <tr><th scope="col">{keyLabel}</th><th scope="col">Recorded Value</th></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.key}-${index}`}>
              <th scope="row"><code>{row.key}</code></th>
              <td data-value-kind={recordedValueKind(row.value)}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrialTable({ table }: { table: ResearchLabDataTable | null }) {
  if (!table) {
    return <p className="rlaw-record-empty">Protocol Trial Definition: NONE_RECORDED</p>;
  }
  return (
    <div className="rlaw-table-scroll" tabIndex={0} aria-label="Recorded Protocol Trials">
      <table className="rlaw-evidence-table rlaw-trial-table">
        <caption className="rlaw-visually-hidden">Recorded Protocol Trials</caption>
        <thead>
          <tr>{table.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${row.trial ?? rowIndex}-${rowIndex}`}>
              {table.columns.map((column, columnIndex) => {
                const value = row[column] ?? 'NONE_RECORDED';
                return columnIndex === 0
                  ? <th scope="row" key={column} data-value-kind={recordedValueKind(value)}>{value}</th>
                  : <td key={column} data-value-kind={recordedValueKind(value)}>{value}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GateTable({ rows }: { rows: readonly ResearchLabGateRow[] }) {
  if (rows.length === 0) {
    return <p className="rlaw-record-empty">Formal Gate Evaluations: NONE_RECORDED</p>;
  }
  const visibleRows = rows.slice(0, 180);
  return (
    <>
      <div className="rlaw-table-scroll" tabIndex={0} aria-label="Recorded Gate Evaluations">
        <table className="rlaw-evidence-table rlaw-gate-table">
          <caption className="rlaw-visually-hidden">Recorded Gate Evaluations</caption>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Extracted Label</th>
              <th scope="col">Recorded Path</th>
              <th scope="col">Observed</th>
              <th scope="col">Threshold</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${row.path}-${row.code}-${index}`}>
                <td><span data-gate-tone={gateStatusTone(row.status)}>{row.status}</span></td>
                <th scope="row"><code>{row.code}</code></th>
                <td><code>{row.path || '(root)'}</code></td>
                <td data-value-kind={recordedValueKind(row.observed)}>{row.observed}</td>
                <td data-value-kind={recordedValueKind(row.threshold)}>{row.threshold}</td>
                <td data-value-kind={recordedValueKind(row.reason)}>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length ? (
        <p className="rlaw-record-note">
          {rows.length - visibleRows.length} additional projected rows remain available in Raw View.
        </p>
      ) : null}
    </>
  );
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isMarkdownTableDivider(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function inlineEvidence(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\)\n]+\))/gu;
  let cursor = 0;
  let tokenIndex = 0;
  for (const match of text.matchAll(token)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const value = match[0];
    if (value.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-code-${tokenIndex}`}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-strong-${tokenIndex}`}>{value.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(value);
      if (link) {
        nodes.push(
          <span
            className="rlaw-inert-link"
            key={`${keyPrefix}-link-${tokenIndex}`}
            title="Preserved reference only. Links are inert in the Research Lab."
          >
            <span>{link[1]}</span>
            <code>{link[2]}</code>
          </span>,
        );
      } else {
        nodes.push(value);
      }
    }
    cursor = start + value.length;
    tokenIndex += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function startsMarkdownBlock(line: string, nextLine: string | undefined): boolean {
  const trimmed = line.trim();
  return trimmed === ''
    || /^```/u.test(trimmed)
    || /^#{1,6}\s+/u.test(trimmed)
    || /^(?:[-+*])\s+/u.test(trimmed)
    || /^\d+[.)]\s+/u.test(trimmed)
    || /^>\s?/u.test(trimmed)
    || /^(?:-{3,}|\*{3,}|_{3,})$/u.test(trimmed)
    || (line.includes('|') && nextLine !== undefined && isMarkdownTableDivider(nextLine));
}

function SafeTextDocument({ raw }: { raw: string }) {
  const lines = raw.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    const fence = /^```([^\s`]*)\s*$/u.exec(trimmed);
    if (fence) {
      const language = fence[1];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="rlaw-markdown-code" key={`code-${index}`} aria-label={language ? `${language} Code Block` : 'Code Block'}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(trimmed);
    if (heading) {
      const depth = heading[1].length;
      const content = inlineEvidence(heading[2], `heading-${index}`);
      blocks.push(depth === 1
        ? <h4 key={`heading-${index}`}>{content}</h4>
        : depth === 2
          ? <h5 key={`heading-${index}`}>{content}</h5>
          : <h6 key={`heading-${index}`}>{content}</h6>);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1])) {
      const headers = splitMarkdownTableRow(line);
      const body: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        body.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="rlaw-markdown-table-scroll" tabIndex={0} aria-label="Preserved Text Table" key={`table-${index}`}>
          <table>
            <thead><tr>{headers.map((header, cellIndex) => <th scope="col" key={`${header}-${cellIndex}`}>{inlineEvidence(header, `table-head-${index}-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`table-row-${index}-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`table-cell-${index}-${rowIndex}-${cellIndex}`}>
                      {inlineEvidence(row[cellIndex] ?? '', `table-cell-${index}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = /^[-+*]\s+(.+)$/u.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/u.exec(trimmed);
    if (unordered || ordered) {
      const items: string[] = [];
      const listPattern = unordered ? /^[-+*]\s+(.+)$/u : /^\d+[.)]\s+(.+)$/u;
      while (index < lines.length) {
        const item = listPattern.exec(lines[index].trim());
        if (!item) break;
        let itemText = item[1];
        index += 1;
        while (
          index < lines.length
          && /^\s{2,}\S/u.test(lines[index])
          && !listPattern.test(lines[index].trim())
        ) {
          itemText += ` ${lines[index].trim()}`;
          index += 1;
        }
        items.push(itemText);
      }
      const children = items.map((item, itemIndex) => (
        <li key={`list-item-${index}-${itemIndex}`}>{inlineEvidence(item, `list-${index}-${itemIndex}`)}</li>
      ));
      blocks.push(unordered
        ? <ul key={`list-${index}`}>{children}</ul>
        : <ol key={`list-${index}`}>{children}</ol>);
      continue;
    }

    if (/^>\s?/u.test(trimmed)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/u.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/u, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>{inlineEvidence(quote.join(' '), `quote-${index}`)}</blockquote>,
      );
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    const paragraph = [trimmed];
    index += 1;
    while (
      index < lines.length
      && !startsMarkdownBlock(lines[index], lines[index + 1])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${index}`}>{inlineEvidence(paragraph.join(' '), `paragraph-${index}`)}</p>,
    );
  }

  return <article className="rlaw-text-document">{blocks}</article>;
}

function StructuredArtifact({ loaded }: { loaded: LoadedResearchArtifact }) {
  const { artifact, payload, raw } = loaded;
  if (artifact.format === 'TEXT') return <SafeTextDocument raw={raw} />;

  const topLevel = researchLabTopLevelRows(payload);
  const trials = researchLabTrialTable(payload);
  const parameters = researchLabParameterRows(payload);
  const gates = researchLabGateRows(payload);
  const seals = researchLabSealRows(payload);
  const isProtocol = artifact.role === 'PROTOCOL';
  const isOutcome = artifact.role === 'RESULT' || artifact.role === 'DEVELOPMENT';
  const isFreeze = artifact.role === 'FREEZE';

  return (
    <div className="rlaw-structured-document">
      <EvidenceSection
        eyebrow="Readable Projection"
        title="Top-Level Recorded Fields"
        detail={`${topLevel.length} Recorded Fields · Raw Is Canonical`}
      >
        <KeyValueTable caption="Top-Level Recorded Fields" rows={topLevel} keyLabel="Recorded Field" />
      </EvidenceSection>

      {isProtocol ? (
        <>
          <EvidenceSection
            eyebrow="Protocol"
            title="Trial Definition"
            detail={trials ? `${trials.totalRows} Recorded ${trials.totalRows === 1 ? 'Row' : 'Rows'} · ${trials.path}` : 'NONE_RECORDED'}
          >
            <TrialTable table={trials} />
          </EvidenceSection>
          <EvidenceSection
            eyebrow="Protocol"
            title="Parameters And Constraints"
            detail={`${parameters.length} Extracted Paths`}
          >
            <KeyValueTable caption="Recorded Protocol Parameters" rows={parameters} />
          </EvidenceSection>
        </>
      ) : null}

      {isOutcome ? (
        <EvidenceSection
          eyebrow="Derived Outcome Projection"
          title="Recorded Gate-Like Evaluations"
          detail={`${gates.length} Extracted Rows · Paths Preserved`}
        >
          <GateTable rows={gates} />
        </EvidenceSection>
      ) : null}

      {(isFreeze || seals.length > 0) ? (
        <EvidenceSection
          eyebrow={isFreeze ? 'Freeze Record Projection' : 'Digest Projection'}
          title="Digest And Freeze Identity Fields"
          detail={`${seals.length} Extracted Paths · Raw Is Canonical`}
        >
          <KeyValueTable caption="Recorded Seals Digests And Identity Fields" rows={seals} />
        </EvidenceSection>
      ) : null}
    </div>
  );
}

function IntegrityStatus({ state }: { state: BoundArtifactLoadState }) {
  if (state.status === 'READY') {
    return (
      <div className="rlaw-integrity" data-integrity="verified" role="status">
        <ShieldCheck size={17} aria-hidden="true" />
        <div>
          <strong>Manifest Match</strong>
          <span>{state.loaded.verifiedBytes.toLocaleString('en-US')} Bytes · SHA-256 Matched</span>
        </div>
      </div>
    );
  }
  if (state.status === 'INVALID') {
    return (
      <div className="rlaw-integrity" data-integrity="invalid" role="alert">
        <FileText size={17} aria-hidden="true" />
        <div>
          <strong>Artifact Unavailable</strong>
          <span>{state.error}. Structured and Raw evidence remain closed.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rlaw-integrity" data-integrity="checking" role="status">
      <FileCheck2 size={17} aria-hidden="true" />
      <div>
        <strong>Integrity Check In Progress</strong>
        <span>Checking the static copy against its exact byte count and SHA-256 manifest entry.</span>
      </div>
    </div>
  );
}

export function ResearchLabArtifactWorkbench({
  family,
  artifacts,
  requestedArtifact = null,
  initialView = 'STRUCTURED',
  className = '',
}: ResearchLabArtifactWorkbenchProps) {
  const baseId = useId();
  const admittedArtifacts = useMemo(
    () => artifactsForRequestFamily(family, artifacts),
    [artifacts, family],
  );
  const preferred = preferredResearchArtifact(admittedArtifacts);
  const [activePath, setActivePath] = useState<string | null>(preferred?.path ?? null);
  const [view, setView] = useState<ResearchLabArtifactView>(initialView);
  const [loadState, setLoadState] = useState<BoundArtifactLoadState>(EMPTY_LOAD_STATE);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const artifactTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const viewTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paneScrollRef = useRef<HTMLDivElement>(null);

  const active = admittedArtifacts.find((artifact) => artifact.path === activePath)
    ?? preferred;
  const activeIndex = active
    ? admittedArtifacts.findIndex((artifact) => artifact.path === active.path)
    : -1;
  const activeTabId = activeIndex >= 0 ? `${baseId}-artifact-tab-${activeIndex}` : undefined;
  const artifactPanelId = `${baseId}-artifact-panel`;
  const viewPanelId = `${baseId}-view-panel`;

  useEffect(() => {
    setActivePath((current) => admittedArtifacts.some((artifact) => artifact.path === current)
      ? current
      : preferredResearchArtifact(admittedArtifacts)?.path ?? null);
  }, [admittedArtifacts]);

  useEffect(() => {
    const requested = resolveArtifactRequest(requestedArtifact, family, admittedArtifacts);
    if (!requested) return;
    setActivePath(requested.path);
    paneScrollRef.current?.scrollTo({ top: 0 });
  }, [admittedArtifacts, family, requestedArtifact?.family, requestedArtifact?.nonce, requestedArtifact?.path]);

  useEffect(() => {
    if (!active) {
      setLoadState(EMPTY_LOAD_STATE);
      return;
    }
    const controller = new AbortController();
    const artifactPath = active.path;
    const artifactSha256 = active.sha256;
    setLoadState({
      status: 'LOADING',
      artifactPath,
      artifactSha256,
      loaded: null,
      error: null,
    });
    paneScrollRef.current?.scrollTo({ top: 0 });
    void loadResearchArtifact(active, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setLoadState({
            status: 'READY',
            artifactPath,
            artifactSha256,
            loaded,
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadState({
            status: 'INVALID',
            artifactPath,
            artifactSha256,
            loaded: null,
            error: error instanceof Error ? error.message : 'RESEARCH_LAB_ARTIFACT_INVALID',
          });
        }
      });
    return () => controller.abort();
  }, [active, reloadEpoch]);

  const selectArtifact = (artifact: ResearchLabArtifact) => {
    setActivePath(artifact.path);
    paneScrollRef.current?.scrollTo({ top: 0 });
  };

  const handleArtifactTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % admittedArtifacts.length;
    else if (event.key === 'ArrowUp') nextIndex = (index - 1 + admittedArtifacts.length) % admittedArtifacts.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = admittedArtifacts.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectArtifact(admittedArtifacts[index]);
      return;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      artifactTabRefs.current[nextIndex]?.focus();
    }
  };

  const activateViewAt = (index: number) => {
    const next = VIEW_TABS[index];
    setView(next.id);
    viewTabRefs.current[index]?.focus();
  };

  const handleViewTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % VIEW_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + VIEW_TABS.length) % VIEW_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = VIEW_TABS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      activateViewAt(nextIndex);
    }
  };

  const rootClassName = ['rlaw-workbench', className].filter(Boolean).join(' ');

  if (!active || admittedArtifacts.length === 0) {
    return (
      <section className={rootClassName} aria-label={`${family} Preserved Artifact Inspector`}>
        <header className="rlaw-workbench-head">
          <div>
            <span>Preserved Artifact Inspector</span>
            <h3 tabIndex={-1}>{family}</h3>
          </div>
        </header>
        <div className="rlaw-empty-bundle">
          <strong>PRESERVED_ARTIFACTS: NONE_RECORDED</strong>
          <code>{RESEARCH_LAB_ARTIFACT_PROVENANCE.sourcePath}/{family}</code>
          <span>No dead link or inferred artifact control is shown.</span>
        </div>
      </section>
    );
  }

  const stateMatchesActive = loadState.artifactPath === active.path
    && loadState.artifactSha256 === active.sha256;
  const presentedLoadState: BoundArtifactLoadState = stateMatchesActive
    ? loadState
    : {
      status: 'LOADING',
      artifactPath: active.path,
      artifactSha256: active.sha256,
      loaded: null,
      error: null,
    };
  const loaded = presentedLoadState.status === 'READY' ? presentedLoadState.loaded : null;

  return (
    <section
      className={rootClassName}
      aria-labelledby={`${baseId}-workbench-title`}
      data-artifact-status={presentedLoadState.status}
    >
      <header className="rlaw-workbench-head">
        <div>
          <span>Preserved Artifact Inspector</span>
          <h3 id={`${baseId}-workbench-title`} tabIndex={-1}>{family} Evidence Bundle</h3>
          <code>{RESEARCH_LAB_ARTIFACT_PROVENANCE.versionedRoot}/{family}</code>
        </div>
        <div className="rlaw-readonly-boundary">
          <ShieldCheck size={16} aria-hidden="true" />
          <div><strong>Read-Only</strong><span>Verified Before Display</span></div>
        </div>
      </header>

      <div className="rlaw-compact-picker">
        <label htmlFor={`${baseId}-artifact-select`}>Artifact File</label>
        <select
          id={`${baseId}-artifact-select`}
          value={active.path}
          onChange={(event) => {
            const next = admittedArtifacts.find((artifact) => artifact.path === event.target.value);
            if (next) selectArtifact(next);
          }}
        >
          {admittedArtifacts.map((artifact) => (
            <option value={artifact.path} key={artifact.path}>
              {artifactRoleLabel(artifact)} · {artifact.name} · {readableResearchLabBytes(artifact.bytes)}
            </option>
          ))}
        </select>
        <ChevronDown className="rlaw-compact-picker-chevron" size={16} strokeWidth={1.8} aria-hidden="true" />
      </div>

      <div className="rlaw-workbench-grid">
        <aside className="rlaw-artifact-rail" aria-label={`${family} Artifact Files`}>
          <div className="rlaw-rail-head">
            <span>Artifact Files</span>
            <strong>{admittedArtifacts.length}</strong>
          </div>
          <p id={`${baseId}-tab-instructions`} className="rlaw-visually-hidden">
            Use Up and Down Arrow to move focus. Press Enter or Space to open the focused artifact.
          </p>
          <div
            className="rlaw-artifact-tablist"
            role="tablist"
            aria-label={`${family} Preserved Artifacts`}
            aria-orientation="vertical"
            aria-describedby={`${baseId}-tab-instructions`}
          >
            {admittedArtifacts.map((artifact, index) => {
              const selected = artifact.path === active.path;
              return (
                <button
                  type="button"
                  role="tab"
                  id={`${baseId}-artifact-tab-${index}`}
                  aria-controls={artifactPanelId}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  key={artifact.path}
                  ref={(node) => { artifactTabRefs.current[index] = node; }}
                  onClick={() => selectArtifact(artifact)}
                  onKeyDown={(event) => handleArtifactTabKeyDown(event, index)}
                >
                  <span className="rlaw-artifact-icon">{artifactIcon(artifact)}</span>
                  <span className="rlaw-artifact-labels">
                    <span>{artifactRoleLabel(artifact)}</span>
                    <strong>{artifact.name}</strong>
                    <small>{readableResearchLabBytes(artifact.bytes)} · {artifact.sha256.slice(0, 12)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section
          id={artifactPanelId}
          className="rlaw-artifact-pane"
          role="tabpanel"
          aria-labelledby={activeTabId}
          aria-busy={presentedLoadState.status === 'LOADING'}
        >
          <header className="rlaw-artifact-head">
            <div className="rlaw-artifact-title">
              <span className="rlaw-artifact-icon">{artifactIcon(active, 20)}</span>
              <div>
                <span>{artifactRoleLabel(active)} · {active.format === 'JSON' ? 'JSON' : 'Text'}</span>
                <h4>{active.name}</h4>
              </div>
            </div>
            <div className="rlaw-view-tabs" role="tablist" aria-label="Artifact View">
              {VIEW_TABS.map((tab, index) => (
                <button
                  type="button"
                  role="tab"
                  id={`${baseId}-view-tab-${tab.id.toLowerCase()}`}
                  aria-controls={viewPanelId}
                  aria-selected={view === tab.id}
                  tabIndex={view === tab.id ? 0 : -1}
                  key={tab.id}
                  ref={(node) => { viewTabRefs.current[index] = node; }}
                  onClick={() => setView(tab.id)}
                  onKeyDown={(event) => handleViewTabKeyDown(event, index)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </header>

          <IntegrityStatus state={presentedLoadState} />

          <details className="rlaw-artifact-custody">
            <summary>
              <span><strong>Artifact Custody</strong><small>Path, Full Digest, And Byte Count</small></span>
              <code>{active.sha256.slice(0, 12)} · {active.bytes.toLocaleString('en-US')} B</code>
              <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
            </summary>
            <dl className="rlaw-artifact-meta">
              <div>
                <dt>Preserved Path</dt>
                <dd><code>{RESEARCH_LAB_ARTIFACT_PROVENANCE.versionedRoot}/{active.path}</code></dd>
              </div>
              <div>
                <dt>Manifest SHA-256</dt>
                <dd><code>{active.sha256}</code></dd>
              </div>
              <div>
                <dt>Byte Count</dt>
                <dd>
                  <span>{active.bytes.toLocaleString('en-US')} Expected</span>
                  <span>{loaded ? `${loaded.verifiedBytes.toLocaleString('en-US')} Verified` : 'Verification Pending'}</span>
                </dd>
              </div>
            </dl>
          </details>

          <div className="rlaw-pane-scroll" ref={paneScrollRef}>
            {presentedLoadState.status === 'LOADING' ? (
              <div className="rlaw-artifact-state" role="status">
                <FileCheck2 size={21} aria-hidden="true" />
                <strong>Checking Preserved Bytes</strong>
                <span>No content is rendered until byte count and SHA-256 both match.</span>
              </div>
            ) : presentedLoadState.status === 'INVALID' ? (
              <div className="rlaw-artifact-state" data-state="invalid" role="alert">
                <FileText size={21} aria-hidden="true" />
                <strong>Preserved Artifact Unavailable</strong>
                <span>{presentedLoadState.error}. No partial or unverified content is displayed.</span>
                <button type="button" onClick={() => setReloadEpoch((current) => current + 1)}>
                  <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />
                  Retry Integrity Check
                </button>
              </div>
            ) : (
              <section
                id={viewPanelId}
                className="rlaw-view-panel"
                role="tabpanel"
                aria-labelledby={`${baseId}-view-tab-${view.toLowerCase()}`}
              >
                {view === 'RAW' ? (
                  <pre className="rlaw-raw-document" tabIndex={0} aria-label={`Exact Raw ${active.format === 'JSON' ? 'JSON' : 'Text'}`}>
                    <code>{presentedLoadState.loaded.raw}</code>
                  </pre>
                ) : (
                  <StructuredArtifact loaded={presentedLoadState.loaded} />
                )}
              </section>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
