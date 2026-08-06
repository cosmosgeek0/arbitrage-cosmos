import {
  Archive,
  CircleSlash2,
  FileQuestion,
  FlaskConical,
  LibraryBig,
  Search,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  ResearchLabCounts,
  ResearchLabFilter,
} from '../../data/researchLab';
import './ResearchLabOverview.css';

export type ResearchLabOverviewDatasetState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'INVALID' }>
  | Readonly<{
      status: 'READY';
      counts: ResearchLabCounts;
      visibleCount: number;
    }>;

export type ResearchLabOverviewProps = Readonly<{
  dataset: ResearchLabOverviewDatasetState;
  filter: ResearchLabFilter;
  query: string;
  filtersEnabled: boolean;
  onFilterChange: (filter: ResearchLabFilter) => void;
  onQueryChange: (query: string) => void;
}>;

type PrimaryOutcomeItem = Readonly<{
  id: Extract<ResearchLabFilter, 'ALL' | 'NO_GO' | 'UNMEASURED' | 'NONE_RECORDED'>;
  eyebrow: string;
  title: string;
  description: string;
  countKey: keyof ResearchLabCounts;
  icon: LucideIcon;
}>;

type SecondaryOutcomeItem = Readonly<{
  id: Extract<ResearchLabFilter, 'SPECIAL' | 'TERMINAL'>;
  label: string;
  detail: string;
  countKey: keyof ResearchLabCounts;
}>;

const PRIMARY_OUTCOMES: readonly PrimaryOutcomeItem[] = Object.freeze([
  Object.freeze({
    id: 'ALL',
    eyebrow: 'What Was Tested',
    title: 'The Full Census',
    description: 'Every experiment family admitted by the frozen index, without hiding unfinished work.',
    countKey: 'all',
    icon: LibraryBig,
  }),
  Object.freeze({
    id: 'NO_GO',
    eyebrow: 'What Conclusively Failed',
    title: 'Recorded NO_GO',
    description: 'Negative verdicts remain visible as settled evidence, not candidates to quietly restore.',
    countKey: 'noGo',
    icon: CircleSlash2,
  }),
  Object.freeze({
    id: 'UNMEASURED',
    eyebrow: 'What Could Not Be Measured',
    title: 'Measurement Unavailable',
    description: 'The record could not support a measured answer; absence is never rendered as success.',
    countKey: 'unmeasured',
    icon: Archive,
  }),
  Object.freeze({
    id: 'NONE_RECORDED',
    eyebrow: 'What Never Reached An Answer',
    title: 'No Final Verdict',
    description: 'The preserved family contains no recorded terminal answer and remains explicitly unresolved.',
    countKey: 'noneRecorded',
    icon: FileQuestion,
  }),
]);

const SECONDARY_OUTCOMES: readonly SecondaryOutcomeItem[] = Object.freeze([
  Object.freeze({
    id: 'TERMINAL',
    label: 'Terminal Evidence',
    detail: 'Families sealed by the terminal research audit class',
    countKey: 'terminal',
  }),
  Object.freeze({
    id: 'SPECIAL',
    label: 'Other Exact Verdicts',
    detail: 'Nonstandard codes preserved verbatim',
    countKey: 'special',
  }),
]);

function datasetCount(
  dataset: ResearchLabOverviewDatasetState,
  key: keyof ResearchLabCounts,
): number | 'UNKNOWN' {
  return dataset.status === 'READY' ? dataset.counts[key] : 'UNKNOWN';
}

function datasetCopy(dataset: ResearchLabOverviewDatasetState): Readonly<{
  label: string;
  detail: string;
}> {
  if (dataset.status === 'READY') {
    return Object.freeze({
      label: 'Frozen Dataset Validated',
      detail: `${dataset.counts.all} Families · ${dataset.counts.fileReferences.toLocaleString('en-US')} File References`,
    });
  }
  if (dataset.status === 'LOADING') {
    return Object.freeze({ label: 'Checking Frozen Dataset', detail: 'Counts Remain UNKNOWN' });
  }
  return Object.freeze({ label: 'Frozen Dataset Unavailable', detail: 'Counts Remain UNKNOWN' });
}

function resultCopy(dataset: ResearchLabOverviewDatasetState): Readonly<{
  value: string;
  detail: string;
}> {
  if (dataset.status !== 'READY') {
    return Object.freeze({ value: 'UNKNOWN', detail: 'Visible Family Count' });
  }
  return Object.freeze({
    value: dataset.visibleCount.toLocaleString('en-US'),
    detail: `Of ${dataset.counts.all} Families In View`,
  });
}

export function ResearchLabOverview({
  dataset,
  filter,
  query,
  filtersEnabled,
  onFilterChange,
  onQueryChange,
}: ResearchLabOverviewProps) {
  const datasetText = datasetCopy(dataset);
  const visibleResult = resultCopy(dataset);

  return (
    <header className="research-overview" aria-labelledby="research-overview-title">
      <div className="research-overview__masthead">
        <div className="research-overview__identity">
          <span className="research-overview__mark" aria-hidden="true">
            <FlaskConical size={24} strokeWidth={1.65} />
          </span>
          <div>
            <span className="research-overview__eyebrow">Historical Evidence Workspace</span>
            <h1 id="research-overview-title">Research Lab</h1>
            <p>Recorded experiments, decisions, and preserved evidence</p>
          </div>
        </div>

        <div className="research-overview__tools">
          <div
            className="research-overview__dataset"
            data-state={dataset.status.toLowerCase()}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            <span>
              <strong>{datasetText.label}</strong>
              <small>{datasetText.detail}</small>
            </span>
          </div>

          {filtersEnabled ? (
            <div className="research-overview__search" role="search">
              <Search size={17} strokeWidth={1.65} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search Family Index"
                autoComplete="off"
                placeholder="Search families, verdicts, branches, or artifacts"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query.length > 0) {
                    event.preventDefault();
                    onQueryChange('');
                  }
                }}
                spellCheck={false}
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  aria-label="Clear Family Index Search"
                  onClick={() => onQueryChange('')}
                >
                  <X size={16} strokeWidth={1.7} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : (
            <div className="research-overview__scope" role="note">
              <strong>{dataset.status === 'READY' ? `All ${dataset.counts.all} Families` : 'Whole Frozen Census'}</strong>
              <span>Derived views do not inherit catalog filters</span>
            </div>
          )}
        </div>
      </div>

      {filtersEnabled ? (
        <section className="research-overview__composition" aria-labelledby="research-outcome-map-title">
          <div className="research-overview__composition-head">
            <div>
              <span>Recorded Outcome Map</span>
              <h2 id="research-outcome-map-title">What the research actually established</h2>
              <p>Each count is taken from the frozen 84-family index. Missing evidence stays unresolved.</p>
            </div>
            <div className="research-overview__result" role="status" aria-live="polite">
              <strong>{visibleResult.value}</strong>
              <small>{visibleResult.detail}</small>
            </div>
          </div>

          <div className="research-overview__composition-body">
            <div className="research-overview__outcomes" role="group" aria-label="Recorded Outcome Filter">
              {PRIMARY_OUTCOMES.map((item) => {
                const selected = filter === item.id;
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={selected ? 'is-selected' : ''}
                    data-outcome={item.id.toLowerCase().replaceAll('_', '-')}
                    aria-pressed={selected}
                    onClick={() => onFilterChange(item.id)}
                  >
                    <span className="research-overview__outcome-icon" aria-hidden="true">
                      <Icon size={18} strokeWidth={1.65} />
                    </span>
                    <span className="research-overview__outcome-copy">
                      <small>{item.eyebrow}</small>
                      <strong>{datasetCount(dataset, item.countKey)}</strong>
                      <b>{item.title}</b>
                      <span>{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <aside className="research-overview__integrity" aria-label="Record Integrity">
              <header>
                <span aria-hidden="true"><ShieldCheck size={18} strokeWidth={1.65} /></span>
                <div>
                  <strong>Record Integrity</strong>
                  <small>Exact exceptions and custody</small>
                </div>
              </header>

              {SECONDARY_OUTCOMES.map((item) => {
                const selected = filter === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={selected ? 'is-selected' : ''}
                    aria-pressed={selected}
                    onClick={() => onFilterChange(item.id)}
                  >
                    <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    <b>{datasetCount(dataset, item.countKey)}</b>
                  </button>
                );
              })}

              <div className="research-overview__integrity-row">
                <span><strong>Source File References</strong><small>Recorded by the frozen index</small></span>
                <b>{datasetCount(dataset, 'fileReferences')}</b>
              </div>
            </aside>
          </div>
        </section>
      ) : null}
    </header>
  );
}
