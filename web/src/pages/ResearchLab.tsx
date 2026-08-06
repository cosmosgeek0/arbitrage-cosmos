import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FlaskConical, Search, X } from 'lucide-react';
import {
  RESEARCH_LAB_DATASET_PROVENANCE,
  RESEARCH_LAB_DATASET_URL,
  parseResearchLabIndex,
  projectResearchLabDetail,
  researchLabCounts,
  researchLabOutcome,
  selectResearchLabExperiments,
  type ResearchLabCounts,
  type ResearchLabExperiment,
  type ResearchLabFilter,
} from '../data/researchLab';
import './LiveIntelligence.css';
import './ResearchLab.css';

type DatasetState =
  | Readonly<{ status: 'LOADING'; experiments: readonly ResearchLabExperiment[]; error: null }>
  | Readonly<{ status: 'READY'; experiments: readonly ResearchLabExperiment[]; error: null }>
  | Readonly<{ status: 'INVALID'; experiments: readonly ResearchLabExperiment[]; error: string }>;

const EMPTY_EXPERIMENTS = Object.freeze([]) as readonly ResearchLabExperiment[];
const UNKNOWN_COUNTS: ResearchLabCounts = Object.freeze({
  all: 0,
  noGo: 0,
  unmeasured: 0,
  noneRecorded: 0,
  special: 0,
  terminal: 0,
  fileReferences: 0,
});

const FILTERS: readonly Readonly<{ id: ResearchLabFilter; label: string }>[] = Object.freeze([
  { id: 'ALL', label: 'All Families' },
  { id: 'NO_GO', label: 'NO_GO' },
  { id: 'UNMEASURED', label: 'UNMEASURED' },
  { id: 'NONE_RECORDED', label: 'NONE_RECORDED' },
  { id: 'SPECIAL', label: 'Special Outcomes' },
  { id: 'TERMINAL', label: 'Terminal Evidence' },
]);

function filterCount(counts: ResearchLabCounts, filter: ResearchLabFilter): number {
  if (filter === 'ALL') return counts.all;
  if (filter === 'NO_GO') return counts.noGo;
  if (filter === 'UNMEASURED') return counts.unmeasured;
  if (filter === 'NONE_RECORDED') return counts.noneRecorded;
  if (filter === 'SPECIAL') return counts.special;
  return counts.terminal;
}

function outcomeLabel(experiment: ResearchLabExperiment): string {
  const outcome = researchLabOutcome(experiment);
  if (outcome === 'NO_GO') return 'Conclusive Negative Evidence';
  if (outcome === 'UNMEASURED') return 'Could Not Be Measured';
  if (outcome === 'NONE_RECORDED') return 'No Final Answer Recorded';
  return 'Special Recorded Outcome';
}

function briefText(experiment: ResearchLabExperiment): string {
  if (experiment.hypothesis) return experiment.hypothesis;
  if (experiment.protocolId) return experiment.protocolId;
  return 'NONE_RECORDED';
}

function ResearchExperimentRow({
  experiment,
  expanded,
  onToggle,
}: {
  experiment: ResearchLabExperiment;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detail = projectResearchLabDetail(experiment);
  const rowId = `research-family-${experiment.family}`;
  const detailId = `${rowId}-detail`;
  const outcome = researchLabOutcome(experiment).toLowerCase().replace('_', '-');

  return (
    <li className={`researchx-entry${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        id={rowId}
        className="researchx-row"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`researchx-outcome outcome-${outcome}`}>
          <strong>{experiment.verdict}</strong>
          <small>{outcomeLabel(experiment)}</small>
        </span>
        <span className="researchx-family">
          <strong>{experiment.family}</strong>
          <small>{experiment.protocolId || 'Protocol NONE_RECORDED'}</small>
        </span>
        <span className="researchx-brief">
          <strong>{briefText(experiment)}</strong>
          <small>{experiment.hypothesis ? 'Recorded Hypothesis' : experiment.protocolId ? 'Recorded Protocol' : 'No Hypothesis Or Protocol Recorded'}</small>
        </span>
        <span className="researchx-audit">
          <strong>{experiment.auditClass}</strong>
          <small>{experiment.auditCommits === null ? 'Audit Commits NONE_RECORDED' : `${experiment.auditCommits} Recorded Audit Commits`}</small>
        </span>
        <span className="researchx-custody">
          <strong>{experiment.branch}</strong>
          <small>{experiment.tip} · Recorded Tip Prefix</small>
        </span>
        <span className="researchx-file-count">
          <strong>{experiment.files}</strong>
          <small>File References</small>
        </span>
        <ChevronDown className="researchx-chevron" size={16} aria-hidden="true" />
      </button>

      {expanded ? (
        <section
          id={detailId}
          className="researchx-detail"
          role="region"
          aria-labelledby={rowId}
        >
          <header className="researchx-detail-head">
            <span className={`researchx-verdict outcome-${outcome}`}>{detail.verdict}</span>
            <div>
              <h2>{detail.family}</h2>
              <p>{detail.auditClass}</p>
            </div>
          </header>

          <dl className="researchx-facts">
            <div><dt>Family</dt><dd>{detail.family}</dd></div>
            <div><dt>Verdict</dt><dd>{detail.verdict}</dd></div>
            <div><dt>Capital Record</dt><dd>{detail.capital}</dd></div>
            <div><dt>Protocol</dt><dd>{detail.protocolId}</dd></div>
            <div><dt>File Count</dt><dd>{detail.fileCount}</dd></div>
            <div><dt>Audit Commits</dt><dd>{detail.auditCommits}</dd></div>
            <div className="wide"><dt>Source Branch</dt><dd><code>{detail.sourceBranch}</code></dd></div>
            <div><dt>Recorded Tip</dt><dd><code>{detail.recordedTip}</code></dd></div>
            <div className="wide"><dt>Exact Custody</dt><dd><code>{detail.custody}</code></dd></div>
          </dl>

          <div className="researchx-narrative">
            <section>
              <h3>Hypothesis</h3>
              <p>{detail.hypothesis}</p>
            </section>
            <section>
              <h3>Recorded Reason</h3>
              {detail.reasonStructured ? <pre>{detail.reason}</pre> : <p>{detail.reason}</p>}
            </section>
            <section>
              <h3>Reports And Evidence</h3>
              <p>{detail.artifactAccess}</p>
              <code>{detail.custody}</code>
            </section>
          </div>
        </section>
      ) : null}
    </li>
  );
}

export function ResearchLab() {
  const [dataset, setDataset] = useState<DatasetState>({
    status: 'LOADING',
    experiments: EMPTY_EXPERIMENTS,
    error: null,
  });
  const [filter, setFilter] = useState<ResearchLabFilter>('ALL');
  const [query, setQuery] = useState('');
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(RESEARCH_LAB_DATASET_URL, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new TypeError(`RESEARCH_LAB_INDEX_HTTP_${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setDataset({ status: 'READY', experiments: parseResearchLabIndex(payload), error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDataset({
          status: 'INVALID',
          experiments: EMPTY_EXPERIMENTS,
          error: error instanceof Error ? error.message : 'RESEARCH_LAB_INDEX_UNAVAILABLE',
        });
      });
    return () => controller.abort();
  }, []);

  const counts = dataset.status === 'READY' ? researchLabCounts(dataset.experiments) : UNKNOWN_COUNTS;
  const visible = useMemo(
    () => selectResearchLabExperiments(dataset.experiments, filter, query),
    [dataset.experiments, filter, query],
  );

  useEffect(() => {
    if (expandedFamily !== null && !visible.some((experiment) => experiment.family === expandedFamily)) {
      setExpandedFamily(null);
    }
  }, [expandedFamily, visible]);

  const readinessLabel = dataset.status === 'READY'
    ? 'Frozen Index Verified'
    : dataset.status === 'LOADING' ? 'Frozen Index Loading' : 'Frozen Index Invalid';
  const resultLabel = dataset.status === 'READY'
    ? `${visible.length} Of ${counts.all} Experiment Families`
    : 'Experiment Family Count UNKNOWN';

  return (
    <div className="container page lix-page researchx-page">
      <section className="lix-frame researchx-frame" data-research-lab-count={dataset.status === 'READY' ? counts.all : 'UNKNOWN'}>
        <header className="lix-toolbar researchx-toolbar">
          <div className="lix-title researchx-title">
            <FlaskConical className="researchx-page-mark" size={30} aria-hidden="true" />
            <h1>Research Lab</h1>
            <span className="lix-live researchx-readonly"><i aria-hidden="true" />Read-Only Historical Evidence</span>
            <span className="researchx-updated">{readinessLabel}</span>
          </div>
          <label className="lix-search researchx-search">
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search Research Lab"
              placeholder="Search Families, Protocols, Or Custody"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query.length > 0) {
                  event.preventDefault();
                  setQuery('');
                }
              }}
              spellCheck={false}
            />
            {query ? <button type="button" aria-label="Clear Research Search" onClick={() => setQuery('')}><X size={14} /></button> : null}
          </label>
        </header>

        <dl className="researchx-summary" aria-label="Research Lab Overview">
          <div>
            <dt>What Was Tested</dt>
            <dd>{dataset.status === 'READY' ? counts.all : 'UNKNOWN'}</dd>
            <small>{dataset.status === 'READY' ? `Experiment families · ${counts.fileReferences.toLocaleString('en-US')} family file references · 4 audit classes` : 'Frozen scope unavailable'}</small>
          </div>
          <div>
            <dt>Conclusive No-Go</dt>
            <dd>{dataset.status === 'READY' ? counts.noGo : 'UNKNOWN'}</dd>
            <small>Exact NO_GO verdicts · retained as useful negative evidence</small>
          </div>
          <div>
            <dt>Could Not Be Measured</dt>
            <dd>{dataset.status === 'READY' ? counts.unmeasured : 'UNKNOWN'}</dd>
            <small>Exact UNMEASURED verdicts · no result fabricated</small>
          </div>
          <div>
            <dt>No Final Answer</dt>
            <dd>{dataset.status === 'READY' ? counts.noneRecorded : 'UNKNOWN'}</dd>
            <small>Exact NONE_RECORDED verdicts · never promoted to success</small>
          </div>
          <div>
            <dt>Special Outcomes</dt>
            <dd>{dataset.status === 'READY' ? counts.special : 'UNKNOWN'}</dd>
            <small>Nonstandard verdicts preserved verbatim · Terminal evidence {dataset.status === 'READY' ? counts.terminal : 'UNKNOWN'}</small>
          </div>
        </dl>

        <section className="researchx-provenance" aria-label="Frozen Dataset Provenance">
          <div><span>Frozen Source</span><code>{RESEARCH_LAB_DATASET_PROVENANCE.sourcePath}</code></div>
          <div><span>SHA-256</span><code>{RESEARCH_LAB_DATASET_PROVENANCE.sourceSha256}</code></div>
          <div><span>Versioned Copy</span><code>{RESEARCH_LAB_DATASET_PROVENANCE.versionedPath}</code></div>
        </section>

        <section className="lix-filters researchx-filters" aria-label="Research Lab Filters">
          <div className="lix-segments researchx-segments" role="group" aria-label="Outcome And Evidence Filters">
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? 'selected' : ''}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span>{dataset.status === 'READY' ? filterCount(counts, item.id) : 'UNKNOWN'}</span>
              </button>
            ))}
          </div>
          <span className="researchx-result-status" role="status" aria-live="polite">{resultLabel}</span>
        </section>

        <section className="researchx-tape" aria-label="Experiment Family Index">
          <div className="researchx-list-head" aria-hidden="true">
            <span>Outcome</span><span>Family</span><span>Research Brief</span><span>Audit Class</span><span>Recorded Custody</span><span>Files</span><span />
          </div>
          {dataset.status === 'READY' && visible.length > 0 ? (
            <ul className="researchx-list">
              {visible.map((experiment) => (
                <ResearchExperimentRow
                  key={experiment.family}
                  experiment={experiment}
                  expanded={expandedFamily === experiment.family}
                  onToggle={() => setExpandedFamily((current) => current === experiment.family ? null : experiment.family)}
                />
              ))}
            </ul>
          ) : dataset.status === 'LOADING' ? (
            <div className="lix-empty" role="status">Loading Frozen Research Index…</div>
          ) : dataset.status === 'INVALID' ? (
            <div className="lix-empty" role="alert">Research Index Unavailable: {dataset.error}. Counts and verdicts remain UNKNOWN.</div>
          ) : (
            <div className="lix-empty">No Experiment Family Matches This Search And Filter.</div>
          )}
        </section>
      </section>
    </div>
  );
}
