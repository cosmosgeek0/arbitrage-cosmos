/// <reference types="vite/client" />

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RESEARCH_LAB_DATASET_URL,
  parseResearchLabIndex,
  projectResearchLabDetail,
  researchLabCounts,
  selectResearchLabExperiments,
  type ResearchLabExperiment,
  type ResearchLabFilter,
} from '../data/researchLab';
import {
  researchLabArtifactsForFamily,
} from '../data/researchLabArtifacts';
import {
  researchLabFamilyType,
  type ResearchLabFamilyType,
} from '../data/researchLabAnalytics';
import { parseResearchLabStoryLayer } from '../data/researchLabEvidence';
import { ResearchLabAnalytics } from './research-lab/ResearchLabAnalytics';
import {
  ResearchLabCatalog,
  type ResearchLabCatalogRow,
  type ResearchLabCatalogState,
  type ResearchLabComparisonTuple,
} from './research-lab/ResearchLabCatalog';
import {
  ResearchLabCompareModal,
  type ResearchLabCompareCloseReason,
  type ResearchLabComparePair,
} from './research-lab/ResearchLabCompareModal';
import {
  ResearchLabCompareTray,
  type ResearchLabCompareTraySelection,
} from './research-lab/ResearchLabCompareTray';
import {
  ResearchLabDetailSheet,
  type ResearchLabDetailArtifactRequest,
} from './research-lab/ResearchLabDetailSheet';
import { ResearchLabOverview } from './research-lab/ResearchLabOverview';
import { ResearchLabProvenance } from './research-lab/ResearchLabProvenance';
import './ResearchLab.css';

const STORY_MODULE_PATH = '../data/researchLabStories.json';
const storyModules = import.meta.glob<unknown>(
  '../data/researchLabStories.json',
  { eager: true, import: 'default' },
);
const OPTIONAL_STORY_PAYLOAD = storyModules[STORY_MODULE_PATH] ?? null;

type DatasetState =
  | Readonly<{ status: 'LOADING'; experiments: readonly ResearchLabExperiment[]; error: null }>
  | Readonly<{ status: 'READY'; experiments: readonly ResearchLabExperiment[]; error: null }>
  | Readonly<{ status: 'INVALID'; experiments: readonly ResearchLabExperiment[]; error: string }>;

type ResearchLabWorkspace = 'FAMILIES' | 'PATTERNS' | 'CUSTODY';

const EMPTY_EXPERIMENTS = Object.freeze([]) as readonly ResearchLabExperiment[];
const EMPTY_COMPARISON = Object.freeze([null, null]) as ResearchLabComparisonTuple;

const WORKSPACES: readonly Readonly<{
  id: ResearchLabWorkspace;
  label: string;
  count: string;
  heading: string;
  summary: string;
}>[] = Object.freeze([
  Object.freeze({
    id: 'FAMILIES',
    label: 'Families',
    count: '84',
    heading: 'Experiment families',
    summary: 'Search, sort, compare, and open the exact evidence recorded for every family in the frozen census.',
  }),
  Object.freeze({
    id: 'PATTERNS',
    label: 'Patterns',
    count: '3 Views',
    heading: 'Evidence patterns',
    summary: 'Read three honest aggregate views derived from the complete 84-family record, never from the active filter.',
  }),
  Object.freeze({
    id: 'CUSTODY',
    label: 'Custody',
    count: 'Sources',
    heading: 'Frozen custody',
    summary: 'Inspect source provenance, admitted counts, preserved bundle coverage, and the exact recorded digests.',
  }),
]);

const FAMILY_GROUP_LABELS: Readonly<Record<ResearchLabFamilyType, string>> = Object.freeze({
  VOLUME: 'Volume',
  FUNDING: 'Funding',
  GAP: 'Gap',
  DATA_QUALITY: 'Data Quality',
  OTHER_UNCLASSIFIED: 'Other / Unclassified',
});

function comparisonIncludes(
  selection: ResearchLabComparisonTuple,
  family: string,
): boolean {
  return selection[0] === family || selection[1] === family;
}

function comparisonCount(selection: ResearchLabComparisonTuple): number {
  return selection.filter((family): family is string => family !== null).length;
}

function catalogQuestion(
  experiment: ResearchLabExperiment,
  story: ReturnType<typeof parseResearchLabStoryLayer>['stories'][number] | null,
): Readonly<{ text: string; source: string }> {
  if (experiment.hypothesis) {
    return Object.freeze({ text: experiment.hypothesis, source: 'Index Hypothesis' });
  }
  if (story?.kind === 'ARTIFACTS_INSUFFICIENT') {
    return Object.freeze({
      text: 'Validation / tool family; preserved artifacts record no market-experiment hypothesis.',
      source: 'ARTIFACTS_INSUFFICIENT',
    });
  }
  if (story?.kind === 'IN_PROGRESS') {
    return Object.freeze({ text: story.tested, source: 'IN_PROGRESS' });
  }
  if (story) {
    return Object.freeze({ text: story.tested, source: 'Artifact-Derived' });
  }
  if (experiment.protocolId) {
    return Object.freeze({ text: experiment.protocolId, source: 'Recorded Protocol' });
  }
  return Object.freeze({ text: 'NONE_RECORDED', source: 'No Hypothesis Or Protocol Recorded' });
}

function catalogMatchesQuery(
  experiment: ResearchLabExperiment,
  story: ReturnType<typeof parseResearchLabStoryLayer>['stories'][number] | null,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase('en-US');
  if (needle.length === 0) return true;
  const artifactText = researchLabArtifactsForFamily(experiment.family)
    .flatMap((artifact) => [artifact.name, artifact.path, artifact.role])
    .join(' ');
  const storyText = story
    ? [story.kind, story.tested, story.whyItEnded, ...story.sources, story.author].join(' ')
    : '';
  return [
    experiment.family,
    experiment.branch,
    experiment.tip,
    experiment.verdict,
    experiment.protocolId ?? '',
    experiment.hypothesis ?? '',
    experiment.auditClass,
    JSON.stringify(experiment.reason),
    storyText,
    artifactText,
  ].join(' ').toLocaleLowerCase('en-US').includes(needle);
}

function comparisonStatus(selection: ResearchLabComparisonTuple): string {
  const count = comparisonCount(selection);
  if (count === 2) return '2 Selected';
  if (count === 1) return '1 Selected · Choose One More';
  return 'No Families Selected';
}

export function ResearchLab() {
  const [dataset, setDataset] = useState<DatasetState>({
    status: 'LOADING',
    experiments: EMPTY_EXPERIMENTS,
    error: null,
  });
  const [filter, setFilter] = useState<ResearchLabFilter>('ALL');
  const [query, setQuery] = useState('');
  const [workspace, setWorkspace] = useState<ResearchLabWorkspace>('FAMILIES');
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [comparisonFamilies, setComparisonFamilies] = useState<ResearchLabComparisonTuple>(
    EMPTY_COMPARISON,
  );
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [artifactRequest, setArtifactRequest] = useState<ResearchLabDetailArtifactRequest | null>(null);
  const artifactRequestNonce = useRef(0);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const compareTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(RESEARCH_LAB_DATASET_URL, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new TypeError(`RESEARCH_LAB_INDEX_HTTP_${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setDataset({
            status: 'READY',
            experiments: parseResearchLabIndex(payload),
            error: null,
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDataset({
            status: 'INVALID',
            experiments: EMPTY_EXPERIMENTS,
            error: error instanceof Error ? error.message : 'RESEARCH_LAB_INDEX_UNAVAILABLE',
          });
        }
      });
    return () => controller.abort();
  }, []);

  const counts = useMemo(
    () => dataset.status === 'READY' ? researchLabCounts(dataset.experiments) : null,
    [dataset],
  );
  const storyLayer = useMemo(
    () => parseResearchLabStoryLayer(
      dataset.status === 'READY' ? OPTIONAL_STORY_PAYLOAD : null,
      dataset.experiments,
    ),
    [dataset.status, dataset.experiments],
  );
  const storiesByFamily = useMemo(
    () => new Map(storyLayer.stories.map((story) => [story.family, story])),
    [storyLayer.stories],
  );
  const visibleExperiments = useMemo(
    () => selectResearchLabExperiments(dataset.experiments, filter, '')
      .filter((experiment) => catalogMatchesQuery(
        experiment,
        storiesByFamily.get(experiment.family) ?? null,
        query,
      )),
    [dataset.experiments, filter, query, storiesByFamily],
  );
  const catalogRows = useMemo<readonly ResearchLabCatalogRow[]>(
    () => Object.freeze(visibleExperiments.map((experiment) => {
      const question = catalogQuestion(
        experiment,
        storiesByFamily.get(experiment.family) ?? null,
      );
      return Object.freeze({
        family: experiment.family,
        verdict: experiment.verdict,
        testedQuestion: question.text,
        questionSource: question.source,
        familyGroup: FAMILY_GROUP_LABELS[researchLabFamilyType(experiment.family)],
        artifactCount: researchLabArtifactsForFamily(experiment.family).length,
      });
    })),
    [storiesByFamily, visibleExperiments],
  );

  const selectedExperiment = useMemo(
    () => selectedFamily === null
      ? null
      : dataset.experiments.find((experiment) => experiment.family === selectedFamily) ?? null,
    [dataset.experiments, selectedFamily],
  );
  const comparePair = useMemo<ResearchLabComparePair | null>(() => {
    const [leftFamily, rightFamily] = comparisonFamilies;
    if (!leftFamily || !rightFamily) return null;
    const left = dataset.experiments.find((experiment) => experiment.family === leftFamily);
    const right = dataset.experiments.find((experiment) => experiment.family === rightFamily);
    return left && right
      ? Object.freeze([left, right]) as ResearchLabComparePair
      : null;
  }, [comparisonFamilies, dataset.experiments]);
  const compareTraySelection = useMemo<ResearchLabCompareTraySelection>(() => {
    const selected = comparisonFamilies.flatMap((family) => {
      if (!family) return [];
      const experiment = dataset.experiments.find((row) => row.family === family);
      return experiment ? [experiment] : [];
    });
    if (selected.length === 2) {
      return Object.freeze([selected[0], selected[1]]) as ResearchLabCompareTraySelection;
    }
    if (selected.length === 1) {
      return Object.freeze([selected[0]]) as ResearchLabCompareTraySelection;
    }
    return Object.freeze([]) as ResearchLabCompareTraySelection;
  }, [comparisonFamilies, dataset.experiments]);

  const catalogState: ResearchLabCatalogState = dataset.status === 'LOADING'
    ? Object.freeze({ status: 'LOADING' })
    : dataset.status === 'INVALID'
      ? Object.freeze({ status: 'INVALID', reason: dataset.error })
      : Object.freeze({ status: 'READY' });

  const rememberActiveElement = () => {
    detailReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  };

  const openFamily = (family: string, opener: HTMLElement) => {
    detailReturnFocusRef.current = opener;
    setSelectedFamily(family);
  };

  const openArtifact = (family: string, path: string, returnTarget?: HTMLElement | null) => {
    if (returnTarget) detailReturnFocusRef.current = returnTarget;
    else if (selectedFamily === null) rememberActiveElement();
    artifactRequestNonce.current += 1;
    setArtifactRequest(Object.freeze({
      family,
      path,
      nonce: artifactRequestNonce.current,
    }));
    setSelectedFamily(family);
    setComparisonOpen(false);
  };

  const toggleCompareFamily = (family: string) => {
    setComparisonFamilies((current) => {
      if (current[0] === family) return Object.freeze([current[1], null]);
      if (current[1] === family) return Object.freeze([current[0], null]);
      if (current[0] === null) return Object.freeze([family, null]);
      if (current[1] === null) return Object.freeze([current[0], family]);
      return current;
    });
  };

  const clearComparison = () => {
    setComparisonFamilies(EMPTY_COMPARISON);
    setComparisonOpen(false);
  };

  const restoreComparisonFocus = (reason: ResearchLabCompareCloseReason) => {
    if (reason === 'OPEN_ARTIFACT') return;
    if (reason === 'CLEAR') {
      document.querySelector<HTMLElement>('.research-catalog__family-cell button')?.focus({ preventScroll: true });
      return;
    }
    if (reason === 'REMOVE') {
      const trayRemove = document.querySelector<HTMLElement>('.rlcmp-tray-family > button');
      const familyButton = document.querySelector<HTMLElement>('.research-catalog__family-cell button');
      (trayRemove ?? familyButton)?.focus({ preventScroll: true });
      return;
    }
    if (compareTriggerRef.current?.isConnected && !compareTriggerRef.current.disabled) {
      compareTriggerRef.current.focus({ preventScroll: true });
    }
  };

  const selectedCount = comparisonCount(comparisonFamilies);
  const activeWorkspace = WORKSPACES.find((item) => item.id === workspace) ?? WORKSPACES[0];
  const detailCompareSelected = selectedFamily !== null
    && comparisonIncludes(comparisonFamilies, selectedFamily);
  const detailCompareDisabled = selectedCount === 2 && !detailCompareSelected;
  const selectedArtifacts = selectedExperiment
    ? researchLabArtifactsForFamily(selectedExperiment.family)
    : Object.freeze([]);
  const selectedDetail = selectedExperiment
    ? Object.freeze({
      ...projectResearchLabDetail(selectedExperiment),
      artifactAccess: selectedArtifacts.length > 0
        ? `${selectedArtifacts.length} manifest-bound artifact${selectedArtifacts.length === 1 ? '' : 's'} shipped with this read-only page. Open one below to verify its exact byte count and SHA-256 before reading.`
        : 'No preserved artifact directory exists in the copied bundle for this family. Exact frozen-index branch and tip custody remains visible as text.',
    })
    : null;

  return (
    <div className="container page research-lab-page">
      <main
        className="research-lab-shell"
        data-research-lab-count={counts?.all ?? 'UNKNOWN'}
      >
        <ResearchLabOverview
          dataset={dataset.status === 'READY' && counts
            ? { status: 'READY', counts, visibleCount: visibleExperiments.length }
            : dataset.status === 'INVALID'
              ? { status: 'INVALID' }
              : { status: 'LOADING' }}
          filter={filter}
          query={query}
          filtersEnabled={workspace === 'FAMILIES'}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
        />

        <section className="research-lab-record" aria-labelledby="research-lab-workspace-title">
          <header className="research-lab-record__head">
            <div>
              <span>Browse Preserved Evidence</span>
              <h2 id="research-lab-workspace-title">{activeWorkspace.heading}</h2>
              <p>{activeWorkspace.summary}</p>
            </div>

            <nav className="research-lab-workspaces" aria-label="Research Lab Views">
              <div className="research-lab-workspaces__tabs" role="group" aria-label="Research Workspace">
                {WORKSPACES.map((item) => {
                  const selected = workspace === item.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={selected ? 'is-selected' : ''}
                      aria-pressed={selected}
                      onClick={() => setWorkspace(item.id)}
                    >
                      <strong>{item.label}</strong>
                      <small>{item.count}</small>
                    </button>
                  );
                })}
              </div>
            </nav>
          </header>

          {storyLayer.status === 'INVALID' ? (
            <div className="research-lab-alert" role="alert">
              Artifact-Derived Story Layer Invalid: <code>{storyLayer.error}</code>. Frozen index verdicts remain available.
            </div>
          ) : null}

          <ResearchLabCompareTray
            selection={compareTraySelection}
            onOpen={() => setComparisonOpen(true)}
            onClear={clearComparison}
            onRemove={toggleCompareFamily}
            compareButtonRef={compareTriggerRef}
          />

          <section className="research-lab-workspace" data-workspace={workspace.toLowerCase()}>
            {workspace === 'FAMILIES' ? (
              <ResearchLabCatalog
                visibleRows={catalogRows}
                selectedFamily={selectedFamily}
                comparisonFamilies={comparisonFamilies}
                state={catalogState}
                onSelect={openFamily}
                onToggleCompare={toggleCompareFamily}
              />
            ) : workspace === 'PATTERNS' ? (
              dataset.status === 'READY' ? (
                <ResearchLabAnalytics
                  experiments={dataset.experiments}
                  onOpenArtifact={openArtifact}
                />
              ) : (
                <div className="research-lab-unknown" role={dataset.status === 'INVALID' ? 'alert' : 'status'}>
                  <strong>Evidence Patterns Remain UNKNOWN</strong>
                  <span>The complete frozen index must validate before derived analytics render.</span>
                  {dataset.status === 'INVALID' ? <code>{dataset.error}</code> : null}
                </div>
              )
            ) : (
              <div className="research-lab-custody-view">
                <ResearchLabProvenance
                  dataset={dataset.status === 'READY' && counts
                    ? { status: 'READY', counts, error: null }
                    : dataset.status === 'INVALID'
                      ? { status: 'INVALID', counts: null, error: dataset.error }
                      : { status: 'LOADING', counts: null, error: null }}
                  storyLayer={storyLayer}
                  disclosed
                />
              </div>
            )}
          </section>
        </section>
      </main>

      {selectedExperiment && selectedDetail ? (
        <ResearchLabDetailSheet
          experiment={selectedExperiment}
          detail={selectedDetail}
          story={storiesByFamily.get(selectedExperiment.family) ?? null}
          artifacts={selectedArtifacts}
          requestedArtifact={artifactRequest?.family === selectedExperiment.family
            ? artifactRequest
            : null}
          compareSelected={detailCompareSelected}
          compareDisabled={detailCompareDisabled}
          compareStatus={comparisonStatus(comparisonFamilies)}
          returnFocusRef={detailReturnFocusRef}
          onClose={() => setSelectedFamily(null)}
          onCompareToggle={() => toggleCompareFamily(selectedExperiment.family)}
          onOpenArtifact={openArtifact}
        />
      ) : null}

      {comparisonOpen && comparePair ? (
        <ResearchLabCompareModal
          experiments={comparePair}
          onRequestClose={() => setComparisonOpen(false)}
          onRestoreFocus={restoreComparisonFocus}
          onClear={clearComparison}
          onRemove={toggleCompareFamily}
          onOpenArtifact={(family, path) => openArtifact(family, path, compareTriggerRef.current)}
        />
      ) : null}
    </div>
  );
}
