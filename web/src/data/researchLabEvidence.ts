import type { ResearchLabExperiment } from './researchLab';

export const RESEARCH_LAB_STORY_PROVENANCE = Object.freeze({
  sourcePath: '/Users/cosmosgeek/Desktop/researchLabStories.draft.json',
  sourceSha256: 'af6334511142c131e5b82e6b1a870221eb30086c562e3dacd1c78e60fcc9b386',
  sourceBytes: 114_029,
  expectedStories: 72,
  expectedArtifactsInsufficient: 14,
  expectedInProgress: 1,
  expectedIndexNarratives: 12,
  expectedSources: 246,
  versionedPath: 'web/src/data/researchLabStories.json',
  versionedSha256: '151886268bc7dec134197e5f619d5c3ba1f261dbb4f05b4f2421d8f1b3d51907',
  versionedBytes: 114_030,
  note: 'stories derived strictly from Desktop/RESEARCH_LAB_ARTIFACTS sealed files; ARTIFACTS_INSUFFICIENT means the family is a tool/incomplete packet whose folder holds no experiment verdict — displayed as-is, never invented',
});

export const RESEARCH_LAB_BE2_WINDOW_END = '2026-08-12T00:00:00Z (exclusive)';

export type ResearchLabStoryKind = 'ARTIFACT_DERIVED' | 'ARTIFACTS_INSUFFICIENT' | 'IN_PROGRESS';

export type ResearchLabStory = Readonly<{
  family: string;
  kind: ResearchLabStoryKind;
  tested: string;
  whyItEnded: string;
  sources: readonly string[];
  author: string;
}>;

export type ResearchLabStoryCounts = Readonly<{
  total: number;
  artifactDerived: number;
  artifactsInsufficient: number;
  inProgress: number;
  indexNarratives: number;
}>;

export type ResearchLabStoryLayer =
  | Readonly<{
    status: 'NOT_PRESENT';
    stories: readonly ResearchLabStory[];
    provenance: null;
    counts: null;
    error: null;
  }>
  | Readonly<{
    status: 'READY';
    stories: readonly ResearchLabStory[];
    provenance: string;
    counts: ResearchLabStoryCounts;
    error: null;
  }>
  | Readonly<{
    status: 'INVALID';
    stories: readonly ResearchLabStory[];
    provenance: null;
    counts: null;
    error: string;
  }>;

export type ResearchLabKeyValue = Readonly<{ key: string; value: string }>;
export type ResearchLabGateRow = Readonly<{
  code: string;
  status: string;
  path: string;
  observed: string;
  threshold: string;
  reason: string;
}>;
export type ResearchLabDataTable = Readonly<{
  kind: 'ROWS' | 'DEFINITION';
  path: string;
  columns: readonly string[];
  rows: readonly Readonly<Record<string, string>>[];
  totalRows: number;
}>;

const EMPTY_STORIES = Object.freeze([]) as readonly ResearchLabStory[];
const STORY_DOCUMENT_KEYS = new Set(['provenance', 'families']);
const STORY_KEYS = new Set(['family', 'tested', 'why_ended', 'sources', 'author']);
const STORY_SOURCE_NAMES = new Set([
  'README.md',
  'OFFICIAL_SOURCE_RESEARCH.md',
  'protocol.v1.json',
  'result.v1.json',
  'freeze.v1.json',
  'development.v1.json',
  'development-result.v1.json',
  'gen_freeze.v1.json',
  'gen_result.v1.json',
]);
const VERDICT_NORMALIZATION_SOURCE = '/Users/cosmosgeek/Desktop/RESEARCH_LAB_ARTIFACTS/ (directory listing only - the verdict-normalization subdirectory is absent; no artifact files were readable)';
const FAILURE_ARRAY_KEYS = new Set(['gateReasons', 'failedGates', 'failedFormalGates', 'gateFailures']);
const GATE_OBJECT_KEYS = new Set([
  'gates', 'developmentGates', 'holdoutGates', 'primaryGates', 'primary_gates',
  'development_gates', 'holdout_gates',
]);
const GATE_DECISION_KEYS = new Set([
  'gateDecisions', 'developmentGateDecisions', 'holdoutGateDecisions', 'gateResults',
]);
const SEAL_KEY = /(?:sha256|digest|seal|commit|tree|head|frozenAt|frozen_at|createdAt|created_at)$/iu;
const PARAMETER_CONTAINER = /(?:parameters?|params?|trials?|trialFamily|trial_family|trialLedger|candidateGrid|candidates|signal|costs?|capacity|window|selection)$/iu;
const TRIAL_CONTAINER = /^(?:trials?|trialFamily|trial_family)$/u;

export function isResearchLabRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredStoryString(record: Record<string, unknown>, key: string, identity: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`RESEARCH_LAB_STORY_${identity}_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function validStorySource(family: string, source: string): boolean {
  if (STORY_SOURCE_NAMES.has(source)) return true;
  const familyPrefix = `/Users/cosmosgeek/Desktop/RESEARCH_LAB_ARTIFACTS/${family}/`;
  if (source.startsWith(familyPrefix)) return STORY_SOURCE_NAMES.has(source.slice(familyPrefix.length));
  return family === 'verdict-normalization' && source === VERDICT_NORMALIZATION_SOURCE;
}

export function parseResearchLabStoryLayer(
  value: unknown,
  experiments: readonly ResearchLabExperiment[],
): ResearchLabStoryLayer {
  if (value === null || value === undefined) {
    return Object.freeze({
      status: 'NOT_PRESENT',
      stories: EMPTY_STORIES,
      provenance: null,
      counts: null,
      error: null,
    });
  }
  try {
    if (!isResearchLabRecord(value)) throw new TypeError('RESEARCH_LAB_STORY_DOCUMENT_INVALID');
    if (
      Object.keys(value).length !== STORY_DOCUMENT_KEYS.size
      || Object.keys(value).some((key) => !STORY_DOCUMENT_KEYS.has(key))
    ) {
      throw new TypeError('RESEARCH_LAB_STORY_DOCUMENT_KEYS_INVALID');
    }
    const provenance = requiredStoryString(value, 'provenance', 'PROVENANCE');
    if (provenance !== RESEARCH_LAB_STORY_PROVENANCE.note) {
      throw new TypeError('RESEARCH_LAB_STORY_PROVENANCE_INVALID');
    }
    if (experiments.length !== 84) throw new TypeError('RESEARCH_LAB_STORY_INDEX_COUNT_INVALID');
    if (!isResearchLabRecord(value.families)) throw new TypeError('RESEARCH_LAB_STORY_FAMILIES_INVALID');
    const keyedFamilies = Object.entries(value.families);
    if (keyedFamilies.length !== RESEARCH_LAB_STORY_PROVENANCE.expectedStories) {
      throw new TypeError('RESEARCH_LAB_STORY_COUNT_INVALID');
    }
    const experimentsByFamily = new Map(experiments.map((experiment) => [experiment.family, experiment]));
    const seen = new Set<string>();
    const authorCounts = new Map<string, number>();
    let sourceCount = 0;
    const stories = keyedFamilies.map(([objectKey, row]) => {
      if (!isResearchLabRecord(row)) throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_INVALID`);
      if (Object.keys(row).length !== STORY_KEYS.size) {
        throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_KEY_COUNT_INVALID`);
      }
      for (const key of Object.keys(row)) {
        if (!STORY_KEYS.has(key)) throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_${key.toUpperCase()}_UNEXPECTED`);
      }
      const family = requiredStoryString(row, 'family', objectKey);
      if (family !== objectKey) throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_OBJECT_KEY_INVALID`);
      const experiment = experimentsByFamily.get(family);
      if (!experiment || seen.has(family)) {
        throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_INDEX_CUSTODY_INVALID`);
      }
      seen.add(family);
      const tested = requiredStoryString(row, 'tested', objectKey);
      const whyItEnded = requiredStoryString(row, 'why_ended', objectKey);
      const author = requiredStoryString(row, 'author', objectKey);
      const rawSources = row.sources;
      if (
        !Array.isArray(rawSources)
        || rawSources.length === 0
        || rawSources.some((item) => typeof item !== 'string' || !validStorySource(family, item))
      ) {
        throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_SOURCES_INVALID`);
      }
      sourceCount += rawSources.length;
      authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
      const kind: ResearchLabStoryKind = tested === 'ARTIFACTS_INSUFFICIENT'
        ? 'ARTIFACTS_INSUFFICIENT'
        : family === 'be2' ? 'IN_PROGRESS' : 'ARTIFACT_DERIVED';
      if (
        (kind === 'ARTIFACTS_INSUFFICIENT' || kind === 'IN_PROGRESS')
        && experiment.verdict !== 'NONE_RECORDED'
      ) {
        throw new TypeError(`RESEARCH_LAB_STORY_${objectKey}_VERDICT_CLASS_INVALID`);
      }
      if (
        kind === 'IN_PROGRESS'
        && (!whyItEnded.includes('It has not ended and no outcome is recorded') || !whyItEnded.includes('12 August 2026'))
      ) {
        throw new TypeError('RESEARCH_LAB_STORY_BE2_WINDOW_INVALID');
      }
      return Object.freeze({
        family,
        kind,
        tested,
        whyItEnded,
        sources: Object.freeze(rawSources.map(String)),
        author,
      });
    });
    const counts: ResearchLabStoryCounts = Object.freeze({
      total: stories.length,
      artifactDerived: stories.filter((story) => story.kind === 'ARTIFACT_DERIVED').length,
      artifactsInsufficient: stories.filter((story) => story.kind === 'ARTIFACTS_INSUFFICIENT').length,
      inProgress: stories.filter((story) => story.kind === 'IN_PROGRESS').length,
      indexNarratives: experiments.filter((experiment) => !seen.has(experiment.family)).length,
    });
    const omittedExperiments = experiments.filter((experiment) => !seen.has(experiment.family));
    if (
      counts.total !== RESEARCH_LAB_STORY_PROVENANCE.expectedStories
      || counts.artifactDerived !== 57
      || counts.artifactsInsufficient !== RESEARCH_LAB_STORY_PROVENANCE.expectedArtifactsInsufficient
      || counts.inProgress !== RESEARCH_LAB_STORY_PROVENANCE.expectedInProgress
      || counts.indexNarratives !== RESEARCH_LAB_STORY_PROVENANCE.expectedIndexNarratives
      || sourceCount !== RESEARCH_LAB_STORY_PROVENANCE.expectedSources
      || omittedExperiments.some((experiment) => !experiment.hypothesis)
      || authorCounts.get('opus-worker') !== 71
      || authorCounts.get('fable-manual-from-sealed-artifacts') !== 1
      || authorCounts.size !== 2
    ) {
      throw new TypeError('RESEARCH_LAB_STORY_INTEGRITY_INVALID');
    }
    return Object.freeze({
      status: 'READY',
      stories: Object.freeze(stories),
      provenance,
      counts,
      error: null,
    });
  } catch (error: unknown) {
    return Object.freeze({
      status: 'INVALID',
      stories: EMPTY_STORIES,
      provenance: null,
      counts: null,
      error: error instanceof Error ? error.message : 'RESEARCH_LAB_STORIES_INVALID',
    });
  }
}

export function researchLabExactText(value: unknown): string {
  if (value === null) return 'NULL_RECORDED';
  if (value === undefined) return 'NONE_RECORDED';
  if (typeof value === 'string') return value.length > 0 ? value : 'EMPTY_STRING_RECORDED';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.length === 0) return 'EMPTY_ARRAY_RECORDED';
  if (isResearchLabRecord(value) && Object.keys(value).length === 0) return 'EMPTY_OBJECT_RECORDED';
  return JSON.stringify(value) ?? 'NONE_RECORDED';
}

export function researchLabTopLevelRows(value: unknown): readonly ResearchLabKeyValue[] {
  if (!isResearchLabRecord(value)) {
    return Object.freeze([{ key: 'root', value: researchLabExactText(value) }]);
  }
  return Object.freeze(Object.entries(value).map(([key, item]) => {
    if (Array.isArray(item)) {
      return Object.freeze({ key, value: item.length === 0 ? 'EMPTY_ARRAY_RECORDED' : `ARRAY · ${item.length} ITEMS` });
    }
    if (isResearchLabRecord(item)) {
      const fieldCount = Object.keys(item).length;
      return Object.freeze({ key, value: fieldCount === 0 ? 'EMPTY_OBJECT_RECORDED' : `OBJECT · ${fieldCount} FIELDS` });
    }
    return Object.freeze({ key, value: researchLabExactText(item) });
  }));
}

function flattenTableValue(
  value: unknown,
  prefix: string,
  target: Record<string, string>,
  depth: number,
): void {
  if (depth > 3) {
    target[prefix] = researchLabExactText(value);
    return;
  }
  if (value === null || typeof value !== 'object') {
    target[prefix] = researchLabExactText(value);
    return;
  }
  if (Array.isArray(value)) {
    target[prefix] = value.every((item) => item === null || typeof item !== 'object')
      ? researchLabExactText(value)
      : `ARRAY · ${value.length} ITEMS`;
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    flattenTableValue(item, prefix ? `${prefix}.${key}` : key, target, depth + 1);
  }
}

type TrialCandidate = Readonly<{
  kind: 'ROWS' | 'DEFINITION';
  path: string;
  entries: readonly Readonly<{ id: string; value: Record<string, unknown> }>[];
}>;

function collectTrialCandidates(value: unknown, path: string, candidates: TrialCandidate[], depth: number): void {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTrialCandidates(item, `${path}[${index}]`, candidates, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const itemPath = path ? `${path}.${key}` : key;
    if (TRIAL_CONTAINER.test(key)) {
      const arrayEntries = Array.isArray(item)
        ? item.flatMap((trial, index) => isResearchLabRecord(trial) ? [{ id: String(index + 1), value: trial }] : [])
        : [];
      const recordEntries = isResearchLabRecord(item)
        && Object.keys(item).length > 0
        && Object.values(item).every(isResearchLabRecord)
        ? Object.entries(item).map(([id, trial]) => ({ id, value: trial as Record<string, unknown> }))
        : [];
      const entries = arrayEntries.length > 0
        ? arrayEntries
        : recordEntries.length > 0
          ? recordEntries
          : isResearchLabRecord(item)
            ? [{ id: 'recorded-definition', value: item }]
            : [{ id: 'recorded-definition', value: { recordedValue: item } }];
      if (entries.length > 0) {
        candidates.push(Object.freeze({
          kind: arrayEntries.length > 0 || recordEntries.length > 0 ? 'ROWS' : 'DEFINITION',
          path: itemPath,
          entries: Object.freeze(entries),
        }));
      }
    }
    collectTrialCandidates(item, itemPath, candidates, depth + 1);
  }
}

export function researchLabTrialTable(value: unknown): ResearchLabDataTable | null {
  const candidates: TrialCandidate[] = [];
  collectTrialCandidates(value, '', candidates, 0);
  const candidate = candidates.sort(
    (left, right) => (left.kind === right.kind ? 0 : left.kind === 'ROWS' ? -1 : 1)
      || left.path.split('.').length - right.path.split('.').length
      || right.entries.length - left.entries.length,
  )[0];
  if (!candidate) return null;
  const rows = candidate.entries.slice(0, 120).map(({ id, value: trial }) => {
    const row: Record<string, string> = { trial: id };
    flattenTableValue(trial, '', row, 0);
    return Object.freeze(row);
  });
  const columnSet = new Set<string>(['trial']);
  for (const row of rows) for (const key of Object.keys(row)) columnSet.add(key);
  const preferred = ['trialId', 'id', 'name', 'modelId', 'familyId'];
  const columns = [...columnSet].sort((left, right) => {
    if (left === 'trial') return -1;
    if (right === 'trial') return 1;
    const leftRank = preferred.indexOf(left);
    const rightRank = preferred.indexOf(right);
    if (leftRank >= 0 || rightRank >= 0) {
      return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
    }
    return left.localeCompare(right);
  });
  return Object.freeze({
    kind: candidate.kind,
    path: candidate.path,
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
    totalRows: candidate.entries.length,
  });
}

export function researchLabGateRows(value: unknown): readonly ResearchLabGateRow[] {
  const rows: ResearchLabGateRow[] = [];
  const seen = new Set<string>();
  const add = (code: string, status: string, path: string, record?: Record<string, unknown>) => {
    const identity = `${path}\u0000${code}\u0000${status}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    rows.push(Object.freeze({
      code,
      status,
      path,
      observed: record ? researchLabExactText(record.observed ?? record.value ?? record.actual) : 'NONE_RECORDED',
      threshold: record ? researchLabExactText(record.threshold ?? record.limit ?? record.required) : 'NONE_RECORDED',
      reason: record ? researchLabExactText(record.reason ?? record.reasonCode) : 'NONE_RECORDED',
    }));
  };
  const visitGateRecord = (record: Record<string, unknown>, path: string, fallbackCode: string) => {
    const code = researchLabExactText(record.name ?? record.gate ?? record.code ?? record.id ?? fallbackCode);
    const pass = record.pass ?? record.passed;
    if (typeof pass === 'boolean') add(code, pass ? 'PASS' : 'FAIL', path, record);
    else {
      const status = record.status ?? record.result ?? record.decision;
      if (typeof status === 'string' || typeof status === 'boolean') {
        add(code, researchLabExactText(status), path, record);
      }
    }
  };
  const walk = (node: unknown, path: string, key: string, depth: number) => {
    if (depth > 11 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (FAILURE_ARRAY_KEYS.has(key)) {
        node.forEach((item, index) => {
          if (typeof item === 'string') add(item, 'FAIL', `${path}[${index}]`);
          else if (isResearchLabRecord(item)) visitGateRecord(item, `${path}[${index}]`, String(index + 1));
        });
      } else if (GATE_DECISION_KEYS.has(key)) {
        node.forEach((item, index) => {
          if (isResearchLabRecord(item)) visitGateRecord(item, `${path}[${index}]`, String(index + 1));
        });
      }
      node.forEach((item, index) => walk(item, `${path}[${index}]`, key, depth + 1));
      return;
    }
    if (GATE_OBJECT_KEYS.has(key)) {
      for (const [gateCode, gateValue] of Object.entries(node)) {
        const gatePath = `${path}.${gateCode}`;
        if (typeof gateValue === 'boolean') add(gateCode, gateValue ? 'PASS' : 'FAIL', gatePath);
        else if (isResearchLabRecord(gateValue)) visitGateRecord(gateValue, gatePath, gateCode);
      }
    }
    for (const [childKey, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      walk(child, childPath, childKey, depth + 1);
    }
  };
  walk(value, '', '', 0);
  return Object.freeze(rows);
}

function collectMatchingScalars(value: unknown, matcher: RegExp): readonly ResearchLabKeyValue[] {
  const rows: ResearchLabKeyValue[] = [];
  const walk = (node: unknown, path: string, admitted: boolean, depth: number) => {
    if (depth > 12) return;
    if (node === null || typeof node !== 'object') {
      if (admitted && path) rows.push(Object.freeze({ key: path, value: researchLabExactText(node) }));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, admitted, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      walk(item, childPath, admitted || matcher.test(key), depth + 1);
    }
  };
  walk(value, '', false, 0);
  return Object.freeze(rows);
}

export function researchLabSealRows(value: unknown): readonly ResearchLabKeyValue[] {
  return collectMatchingScalars(value, SEAL_KEY);
}

export function researchLabParameterRows(value: unknown): readonly ResearchLabKeyValue[] {
  return collectMatchingScalars(value, PARAMETER_CONTAINER);
}

export function readableResearchLabBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
}
