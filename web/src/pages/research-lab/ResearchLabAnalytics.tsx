import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  RESEARCH_LAB_RECORDED_TIMES,
  researchLabRecordedTimeBuckets,
  researchLabVerdictsByType,
  type ResearchLabRecordedTime,
  type ResearchLabTypeVerdicts,
} from '../../data/researchLabAnalytics';
import {
  researchLabGateSummary,
  type ResearchLabGateCategorySummary,
} from '../../data/researchLabGateAnalytics';
import type { ResearchLabExperiment } from '../../data/researchLab';
import './ResearchLabAnalytics.css';

type AnalyticsLens = 'verdicts' | 'gates' | 'hours';

type OtherRecordedVerdict = Readonly<{
  family: string;
  verdict: string;
}>;

export type ResearchLabAnalyticsProps = Readonly<{
  experiments: readonly ResearchLabExperiment[];
  onOpenArtifact: (family: string, path: string) => void;
}>;

type GateSource = Readonly<{
  family: string;
  artifactPath: string;
  phases: readonly string[];
  codes: readonly string[];
  jsonPaths: readonly string[];
}>;

const ANALYTICS_LENSES: readonly Readonly<{
  id: AnalyticsLens;
  label: string;
  ordinal: string;
}>[] = Object.freeze([
  { id: 'verdicts', label: 'Verdicts By Family Type', ordinal: '01' },
  { id: 'gates', label: 'Formal Gates That Failed Most', ordinal: '02' },
  { id: 'hours', label: 'Experiments Over Time', ordinal: '03' },
]);

function gateSources(category: ResearchLabGateCategorySummary): readonly GateSource[] {
  const sources = new Map<string, {
    family: string;
    artifactPath: string;
    phases: Set<string>;
    codes: Set<string>;
    jsonPaths: Set<string>;
  }>();

  for (const evidence of category.evidence) {
    const identity = `${evidence.family}\u0000${evidence.artifactPath}`;
    const source = sources.get(identity) ?? {
      family: evidence.family,
      artifactPath: evidence.artifactPath,
      phases: new Set<string>(),
      codes: new Set<string>(),
      jsonPaths: new Set<string>(),
    };
    source.phases.add(evidence.phase);
    evidence.codes.forEach((code) => source.codes.add(code));
    source.jsonPaths.add(evidence.jsonPath);
    sources.set(identity, source);
  }

  return Object.freeze([...sources.values()].map((source) => Object.freeze({
    family: source.family,
    artifactPath: source.artifactPath,
    phases: Object.freeze([...source.phases]),
    codes: Object.freeze([...source.codes]),
    jsonPaths: Object.freeze([...source.jsonPaths]),
  })));
}

function segmentWidth(count: number, total: number): string {
  return `${total === 0 ? 0 : count / total * 100}%`;
}

function VerdictLens({
  rows,
  otherRecordedVerdicts,
}: {
  rows: readonly ResearchLabTypeVerdicts[];
  otherRecordedVerdicts: readonly OtherRecordedVerdict[];
}) {
  const totals = rows.reduce((sum, row) => ({
    families: sum.families + row.total,
    noGo: sum.noGo + row.noGo,
    unmeasured: sum.unmeasured + row.unmeasured,
    noneRecorded: sum.noneRecorded + row.noneRecorded,
    special: sum.special + row.special,
  }), { families: 0, noGo: 0, unmeasured: 0, noneRecorded: 0, special: 0 });

  return (
    <>
      <header className="rla-panel-head">
        <div className="rla-panel-copy">
          <span>Lens 01 · Derived Grouping</span>
          <h3>Verdicts By Family Type</h3>
          <p>
            These display groups are derived from recorded family identifiers. The frozen index does not
            record this taxonomy, so Other / Unclassified remains a first-class group.
          </p>
        </div>
        <dl className="rla-summary-tape" aria-label="Verdict Coverage Summary">
          <div><dt>Families</dt><dd>{totals.families}</dd></div>
          <div><dt>NO_GO</dt><dd>{totals.noGo}</dd></div>
          <div><dt>UNMEASURED</dt><dd>{totals.unmeasured}</dd></div>
          <div><dt>NONE_RECORDED</dt><dd>{totals.noneRecorded}</dd></div>
          <div><dt>Other Recorded</dt><dd>{totals.special}</dd></div>
        </dl>
      </header>

      <div className="rla-table-scroll" tabIndex={0} aria-label="Derived Family Group Verdict Counts">
        <table className="rla-verdict-table">
          <caption className="rla-sr-only">
            Exact verdict counts for each UI-derived family group. Groups are not a recorded source taxonomy.
          </caption>
          <thead>
            <tr>
              <th scope="col">Derived Family Group</th>
              <th scope="col">Total</th>
              <th scope="col">NO_GO</th>
              <th scope="col">UNMEASURED</th>
              <th scope="col">NONE_RECORDED</th>
              <th scope="col">Other Recorded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type}>
                <th scope="row">
                  <span className="rla-group-name">{row.label}</span>
                  <span className="rla-verdict-stack" aria-hidden="true">
                    <i className="rla-segment-no-go" style={{ width: segmentWidth(row.noGo, row.total) }} />
                    <i className="rla-segment-unmeasured" style={{ width: segmentWidth(row.unmeasured, row.total) }} />
                    <i className="rla-segment-none" style={{ width: segmentWidth(row.noneRecorded, row.total) }} />
                    <i className="rla-segment-special" style={{ width: segmentWidth(row.special, row.total) }} />
                  </span>
                </th>
                <td className="rla-total-cell">{row.total}</td>
                <td data-outcome="no-go">{row.noGo}</td>
                <td data-outcome="unmeasured">{row.unmeasured}</td>
                <td data-outcome="none-recorded">{row.noneRecorded}</td>
                <td data-outcome="other-recorded">{row.special}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rla-verdict-exceptions" aria-label="Exact Other Recorded Verdicts">
        <span>Other Recorded Verdicts</span>
        {otherRecordedVerdicts.map((row) => (
          <code key={row.family}>{row.family}: {row.verdict}</code>
        ))}
      </div>
      <p className="rla-footnote">
        Every family is counted once. The three standard verdict columns are exact;{' '}
        {otherRecordedVerdicts.length} nonstandard recorded {otherRecordedVerdicts.length === 1 ? 'value is' : 'values are'}
        {' '}grouped for display and preserved verbatim above.
      </p>
    </>
  );
}

function GateSourceButton({
  source,
  onOpenArtifact,
}: {
  source: GateSource;
  onOpenArtifact: ResearchLabAnalyticsProps['onOpenArtifact'];
}) {
  return (
    <button
      type="button"
      className="rla-source-row"
      onClick={() => onOpenArtifact(source.family, source.artifactPath)}
    >
      <span className="rla-source-family">
        <strong>{source.family}</strong>
        <small>{source.phases.join(' · ')}</small>
      </span>
      <span className="rla-source-codes">{source.codes.join(' · ')}</span>
      <code>{source.artifactPath} · {source.jsonPaths.join(' · ')}</code>
      <span className="rla-source-open">Open Evidence</span>
    </button>
  );
}

function GateLens({
  categories,
  noGoFamilies,
  categorizedFamilies,
  uncategorizedFamilies,
  onOpenArtifact,
}: {
  categories: readonly ResearchLabGateCategorySummary[];
  noGoFamilies: number;
  categorizedFamilies: number;
  uncategorizedFamilies: number;
  onOpenArtifact: ResearchLabAnalyticsProps['onOpenArtifact'];
}) {
  const sourcesByCategory = categories.map((category) => ({
    category,
    sources: gateSources(category),
  }));
  const sourceCount = new Set(
    sourcesByCategory.flatMap(({ sources }) => sources.map((source) => `${source.family}\u0000${source.artifactPath}`)),
  ).size;

  return (
    <>
      <header className="rla-panel-head">
        <div className="rla-panel-copy">
          <span>Lens 02 · Family-Deduplicated</span>
          <h3>Formal Gates That Failed Most</h3>
          <p>
            A family enters a category when at least one mapped check failed in any recorded phase or trial.
            Categories overlap, do not sum to {noGoFamilies}, and do not mean every trial failed.
          </p>
        </div>
        <dl className="rla-summary-tape rla-summary-tape-compact" aria-label="Failed Gate Coverage Summary">
          <div><dt>NO_GO Families</dt><dd>{noGoFamilies}</dd></div>
          <div><dt>With Categorized Gate Evidence</dt><dd>{categorizedFamilies}</dd></div>
          <div className="rla-summary-unknown"><dt>Without Categorized Gate Rows</dt><dd>{uncategorizedFamilies}</dd></div>
        </dl>
      </header>

      <ol className="rla-rank-list" aria-label="Failed Formal Gate Categories Ranked By Family Count">
        {categories.map((category, index) => (
          <li key={category.category}>
            <span className="rla-rank">{String(index + 1).padStart(2, '0')}</span>
            <div className="rla-rank-label">
              <strong>{category.label}</strong>
              <small>{category.familyCount} Of {noGoFamilies} NO_GO Families</small>
            </div>
            <div className="rla-rank-track" aria-hidden="true">
              <i style={{ width: `${noGoFamilies === 0 ? 0 : category.familyCount / noGoFamilies * 100}%` }} />
            </div>
            <strong className="rla-rank-count">{category.familyCount}</strong>
          </li>
        ))}
      </ol>

      <details className="rla-source-drawer">
        <summary>
          <span>
            <strong>Evidence Sources</strong>
            <small>Open preserved result artifacts through the page evidence viewer.</small>
          </span>
          <b>{sourceCount} Result Files</b>
        </summary>
        <div className="rla-source-groups">
          {sourcesByCategory.map(({ category, sources }) => (
            <section key={category.category}>
              <header>
                <h4>{category.label}</h4>
                <span>{category.familyCount} Families</span>
              </header>
              <div className="rla-source-list">
                {sources.map((source) => (
                  <GateSourceButton
                    key={`${category.category}-${source.family}-${source.artifactPath}`}
                    source={source}
                    onOpenArtifact={onOpenArtifact}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </details>
    </>
  );
}

function RecordedTimeButton({
  row,
  onOpenArtifact,
}: {
  row: ResearchLabRecordedTime;
  onOpenArtifact: ResearchLabAnalyticsProps['onOpenArtifact'];
}) {
  return (
    <button
      type="button"
      className="rla-source-row rla-time-source-row"
      onClick={() => onOpenArtifact(row.family, row.artifactPath)}
    >
      <span className="rla-source-family"><strong>{row.family}</strong><small>{row.field}</small></span>
      <time dateTime={row.recordedAtUtc}>{row.recordedAtUtc}</time>
      <code>{row.artifactPath}</code>
      <span className="rla-source-open">Open Evidence</span>
    </button>
  );
}

function HoursLens({
  totalFamilies,
  dated,
  unknown,
  buckets,
  sources,
  onOpenArtifact,
}: {
  totalFamilies: number;
  dated: number;
  unknown: number;
  buckets: readonly Readonly<{ hour: string; count: number }>[];
  sources: readonly ResearchLabRecordedTime[];
  onOpenArtifact: ResearchLabAnalyticsProps['onOpenArtifact'];
}) {
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const recordedDates = new Set(sources.map((source) => source.recordedAtUtc.slice(0, 10)));
  const recordedDate = recordedDates.size === 1 ? [...recordedDates][0] ?? null : null;
  const dateLabel = recordedDate ? `${recordedDate} UTC` : 'Mixed UTC Dates';

  return (
    <>
      <header className="rla-panel-head">
        <div className="rla-panel-copy">
          <span>Lens 03 · Artifact Timestamp Coverage</span>
          <h3>Experiments Over Time</h3>
          <p>
            Mixed timestamp fields from preserved result artifacts, grouped by UTC hour. Coverage is
            {` ${dated}/${totalFamilies}`}; these values are custody metadata, not experiment chronology or completion order.
          </p>
        </div>
        <dl className="rla-summary-tape rla-summary-tape-compact" aria-label="Recorded Artifact Timestamp Coverage Summary">
          <div><dt>Timestamped Families</dt><dd>{dated}</dd></div>
          <div className="rla-summary-unknown"><dt>Without Admitted Result Timestamp</dt><dd>{unknown}</dd></div>
          <div><dt>Recorded Date</dt><dd className="rla-date-value">{dateLabel}</dd></div>
        </dl>
      </header>

      <div className="rla-hours-layout">
        <div className="rla-hours-table-wrap">
          <table className="rla-hours-table">
            <caption className="rla-sr-only">Recorded artifact timestamp counts grouped by UTC hour.</caption>
            <thead><tr><th scope="col">UTC Hour</th><th scope="col">Recorded Artifacts</th><th scope="col">Relative Count</th></tr></thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.hour}>
                  <th scope="row">
                    <time dateTime={recordedDate ? `${recordedDate}T${bucket.hour}:00:00Z` : undefined}>{bucket.hour}:00</time>
                  </th>
                  <td>{bucket.count}</td>
                  <td>
                    <span className="rla-hour-track" aria-hidden="true">
                      <i style={{ width: `${bucket.count / maxCount * 100}%` }} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rla-source-drawer">
        <summary>
          <span>
            <strong>Timestamp Evidence Sources</strong>
            <small>Every recorded field stays attached to its preserved result artifact.</small>
          </span>
          <b>{sources.length} Result Files</b>
        </summary>
        <div className="rla-source-list rla-time-source-list">
          {sources.map((row) => (
            <RecordedTimeButton key={`${row.family}-${row.field}`} row={row} onOpenArtifact={onOpenArtifact} />
          ))}
        </div>
      </details>
    </>
  );
}

export function ResearchLabAnalytics({ experiments, onOpenArtifact }: ResearchLabAnalyticsProps) {
  const instanceId = useId();
  const [activeLens, setActiveLens] = useState<AnalyticsLens>('verdicts');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const verdicts = useMemo(() => researchLabVerdictsByType(experiments), [experiments]);
  const otherRecordedVerdicts = useMemo(() => Object.freeze(experiments
    .filter((experiment) => !['NO_GO', 'UNMEASURED', 'NONE_RECORDED'].includes(experiment.verdict))
    .map((experiment) => Object.freeze({
      family: experiment.family,
      verdict: experiment.verdict,
    }))), [experiments]);
  const gates = useMemo(() => researchLabGateSummary(experiments), [experiments]);
  const times = useMemo(() => researchLabRecordedTimeBuckets(experiments), [experiments]);
  const recordedTimeSources = useMemo(() => {
    const admitted = new Set(experiments.map((experiment) => experiment.family));
    return Object.freeze(RESEARCH_LAB_RECORDED_TIMES
      .filter((row) => admitted.has(row.family))
      .sort((left, right) => left.recordedAtUtc.localeCompare(right.recordedAtUtc, 'en-US')));
  }, [experiments]);
  const verdictTotal = verdicts.reduce((total, row) => total + row.total, 0);

  const tabMeta: Readonly<Record<AnalyticsLens, string>> = {
    verdicts: `${verdictTotal} Families · ${verdicts.find((row) => row.type === 'OTHER_UNCLASSIFIED')?.total ?? 0} Other / Unclassified`,
    gates: `${gates.categorizedFamilies} Categorized · ${gates.uncategorizedFamilies} Without Rows`,
    hours: `${times.dated} Timestamped · ${times.unknown} Without Timestamp`,
  };

  function selectLens(index: number) {
    const lens = ANALYTICS_LENSES[index];
    if (!lens) return;
    setActiveLens(lens.id);
    tabRefs.current[index]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ANALYTICS_LENSES.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + ANALYTICS_LENSES.length) % ANALYTICS_LENSES.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ANALYTICS_LENSES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectLens(nextIndex);
  }

  return (
    <section className="researchx-analytics rla-lens" aria-labelledby={`${instanceId}-title`}>
      <h2 className="rla-sr-only" id={`${instanceId}-title`}>Research Evidence Shape</h2>
      <p className="rla-sr-only" id={`${instanceId}-truth-note`}>
        Exact recorded values stay visible. Derived structure is labeled, and missing coverage remains UNKNOWN.
      </p>

      <div className="rla-tabs" role="tablist" aria-label="Research Evidence Analytics">
        {ANALYTICS_LENSES.map((lens, index) => {
          const selected = lens.id === activeLens;
          return (
            <button
              type="button"
              role="tab"
              id={`${instanceId}-tab-${lens.id}`}
              aria-controls={`${instanceId}-panel-${lens.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              key={lens.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              onClick={() => setActiveLens(lens.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              <span className="rla-tab-ordinal">{lens.ordinal}</span>
              <span className="rla-tab-copy"><strong>{lens.label}</strong><small>{tabMeta[lens.id]}</small></span>
            </button>
          );
        })}
      </div>

      <div
        className="rla-panel"
        role="tabpanel"
        id={`${instanceId}-panel-verdicts`}
        aria-labelledby={`${instanceId}-tab-verdicts`}
        aria-describedby={`${instanceId}-truth-note`}
        hidden={activeLens !== 'verdicts'}
        tabIndex={0}
      >
        <VerdictLens rows={verdicts} otherRecordedVerdicts={otherRecordedVerdicts} />
      </div>

      <div
        className="rla-panel"
        role="tabpanel"
        id={`${instanceId}-panel-gates`}
        aria-labelledby={`${instanceId}-tab-gates`}
        aria-describedby={`${instanceId}-truth-note`}
        hidden={activeLens !== 'gates'}
        tabIndex={0}
      >
        <GateLens
          categories={gates.categories}
          noGoFamilies={gates.noGoFamilies}
          categorizedFamilies={gates.categorizedFamilies}
          uncategorizedFamilies={gates.uncategorizedFamilies}
          onOpenArtifact={onOpenArtifact}
        />
      </div>

      <div
        className="rla-panel"
        role="tabpanel"
        id={`${instanceId}-panel-hours`}
        aria-labelledby={`${instanceId}-tab-hours`}
        aria-describedby={`${instanceId}-truth-note`}
        hidden={activeLens !== 'hours'}
        tabIndex={0}
      >
        <HoursLens
          totalFamilies={experiments.length}
          dated={times.dated}
          unknown={times.unknown}
          buckets={times.buckets}
          sources={recordedTimeSources}
          onOpenArtifact={onOpenArtifact}
        />
      </div>
    </section>
  );
}

export default ResearchLabAnalytics;
