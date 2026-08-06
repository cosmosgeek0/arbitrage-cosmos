export const RESEARCH_LAB_DATASET_PROVENANCE = Object.freeze({
  sourcePath: 'Desktop/RESEARCH_LAB_INDEX.json',
  sourceSha256: 'c26da762445455ded10a1d7c2eb2a01102d5e9caf143730515f5a70678d4a13b',
  sourceBytes: 33_897,
  expectedFamilies: 84,
  versionedPath: 'web/src/data/RESEARCH_LAB_INDEX.json',
});

export const RESEARCH_LAB_DATASET_URL = new URL('./RESEARCH_LAB_INDEX.json', import.meta.url).href;

export const TERMINAL_RESEARCH_AUDIT_CLASS = 'terminal research evidence (sealed NO_GO/UNMEASURED verdict chain)';

export type ResearchLabReason = null | readonly string[] | Readonly<Record<string, unknown>>;

export type ResearchLabExperiment = Readonly<{
  family: string;
  branch: string;
  tip: string;
  files: number;
  verdict: string;
  reason: ResearchLabReason;
  protocolId: string | null;
  hypothesis: string | null;
  capital: string | null | undefined;
  auditClass: string;
  auditCommits: number | null;
}>;

export type ResearchLabFilter = 'ALL' | 'NO_GO' | 'UNMEASURED' | 'NONE_RECORDED' | 'SPECIAL' | 'TERMINAL';

export type ResearchLabOutcome = 'NO_GO' | 'UNMEASURED' | 'NONE_RECORDED' | 'SPECIAL';

export type ResearchLabCounts = Readonly<{
  all: number;
  noGo: number;
  unmeasured: number;
  noneRecorded: number;
  special: number;
  terminal: number;
  fileReferences: number;
}>;

export type ResearchLabDetail = Readonly<{
  family: string;
  verdict: string;
  reason: string;
  reasonStructured: boolean;
  protocolId: string;
  hypothesis: string;
  capital: string;
  sourceBranch: string;
  recordedTip: string;
  fileCount: string;
  auditClass: string;
  auditCommits: string;
  custody: string;
  artifactAccess: string;
}>;

const STANDARD_VERDICTS = new Set(['NO_GO', 'UNMEASURED', 'NONE_RECORDED']);
const REQUIRED_KEYS = Object.freeze([
  'family',
  'branch',
  'tip',
  'files',
  'reason',
  'protocol_id',
  'hypothesis',
  'audit_class',
  'audit_commits',
]);
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'verdict', 'capital']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, rowIndex: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function nullableString(record: Record<string, unknown>, key: string, rowIndex: number): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function positiveInteger(record: Record<string, unknown>, key: string, rowIndex: number): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_${key.toUpperCase()}_INVALID`);
  }
  return Number(value);
}

function nullablePositiveInteger(record: Record<string, unknown>, key: string, rowIndex: number): number | null {
  const value = record[key];
  if (value === null) return null;
  return positiveInteger(record, key, rowIndex);
}

function freezeJsonValue(value: unknown, rowIndex: number): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeJsonValue(item, rowIndex)));
  if (isRecord(value)) {
    const frozen: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) frozen[key] = freezeJsonValue(item, rowIndex);
    return Object.freeze(frozen);
  }
  throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_REASON_INVALID`);
}

function reasonValue(value: unknown, rowIndex: number): ResearchLabReason {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_REASON_INVALID`);
    }
    return freezeJsonValue(value, rowIndex) as readonly string[];
  }
  if (isRecord(value) && Object.keys(value).length > 0) {
    return freezeJsonValue(value, rowIndex) as Readonly<Record<string, unknown>>;
  }
  throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_REASON_INVALID`);
}

export function decodeResearchLabExperiment(value: unknown, rowIndex = 0): ResearchLabExperiment {
  if (!isRecord(value)) throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_INVALID`);
  for (const key of REQUIRED_KEYS) {
    if (!(key in value)) throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_${key.toUpperCase()}_MISSING`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_${key.toUpperCase()}_UNEXPECTED`);
  }

  const family = requiredString(value, 'family', rowIndex);
  const branch = requiredString(value, 'branch', rowIndex);
  const tip = requiredString(value, 'tip', rowIndex);
  if (!branch.startsWith('codex/')) throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_BRANCH_INVALID`);
  if (!/^[0-9a-f]{12}$/u.test(tip)) throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_TIP_INVALID`);

  const rawVerdict = value.verdict;
  if (rawVerdict !== undefined && rawVerdict !== null && typeof rawVerdict !== 'string') {
    throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_VERDICT_INVALID`);
  }
  const verdict = typeof rawVerdict === 'string' && rawVerdict.length > 0 ? rawVerdict : 'NONE_RECORDED';
  const rawCapital = value.capital;
  if (rawCapital !== undefined && rawCapital !== null && typeof rawCapital !== 'string') {
    throw new TypeError(`RESEARCH_LAB_ROW_${rowIndex}_CAPITAL_INVALID`);
  }

  return Object.freeze({
    family,
    branch,
    tip,
    files: positiveInteger(value, 'files', rowIndex),
    verdict,
    reason: reasonValue(value.reason, rowIndex),
    protocolId: nullableString(value, 'protocol_id', rowIndex),
    hypothesis: nullableString(value, 'hypothesis', rowIndex),
    capital: rawCapital,
    auditClass: requiredString(value, 'audit_class', rowIndex),
    auditCommits: nullablePositiveInteger(value, 'audit_commits', rowIndex),
  });
}

export function researchLabOutcome(experiment: ResearchLabExperiment): ResearchLabOutcome {
  if (experiment.verdict === 'NO_GO') return 'NO_GO';
  if (experiment.verdict === 'UNMEASURED') return 'UNMEASURED';
  if (experiment.verdict === 'NONE_RECORDED') return 'NONE_RECORDED';
  return 'SPECIAL';
}

export function researchLabCounts(experiments: readonly ResearchLabExperiment[]): ResearchLabCounts {
  const counts = {
    all: experiments.length,
    noGo: 0,
    unmeasured: 0,
    noneRecorded: 0,
    special: 0,
    terminal: 0,
    fileReferences: 0,
  };
  for (const experiment of experiments) {
    const outcome = researchLabOutcome(experiment);
    if (outcome === 'NO_GO') counts.noGo += 1;
    else if (outcome === 'UNMEASURED') counts.unmeasured += 1;
    else if (outcome === 'NONE_RECORDED') counts.noneRecorded += 1;
    else counts.special += 1;
    if (experiment.auditClass === TERMINAL_RESEARCH_AUDIT_CLASS) counts.terminal += 1;
    counts.fileReferences += experiment.files;
  }
  return Object.freeze(counts);
}

function assertFrozenIndex(experiments: readonly ResearchLabExperiment[]): void {
  const families = new Set(experiments.map((experiment) => experiment.family));
  const custodyPairs = new Set(experiments.map((experiment) => `${experiment.branch}\u0000${experiment.tip}`));
  const counts = researchLabCounts(experiments);
  if (experiments.length !== RESEARCH_LAB_DATASET_PROVENANCE.expectedFamilies || families.size !== experiments.length) {
    throw new TypeError('RESEARCH_LAB_INDEX_FAMILY_INTEGRITY_INVALID');
  }
  if (
    counts.noGo !== 21
    || counts.unmeasured !== 23
    || counts.noneRecorded !== 38
    || counts.special !== 2
    || counts.terminal !== 49
    || counts.fileReferences !== 1_112
    || custodyPairs.size !== 82
  ) {
    throw new TypeError('RESEARCH_LAB_INDEX_COUNT_INTEGRITY_INVALID');
  }
}

export function parseResearchLabIndex(value: unknown): readonly ResearchLabExperiment[] {
  if (!Array.isArray(value)) throw new TypeError('RESEARCH_LAB_INDEX_NOT_ARRAY');
  const experiments = Object.freeze(value.map((row, index) => decodeResearchLabExperiment(row, index)));
  assertFrozenIndex(experiments);
  return experiments;
}

export function recordedReasonText(reason: ResearchLabReason): string {
  if (reason === null) return 'NONE_RECORDED';
  if (Array.isArray(reason)) return reason.join(' · ');
  return JSON.stringify(reason) ?? 'NONE_RECORDED';
}

function normalizedSearchText(experiment: ResearchLabExperiment): string {
  return [
    experiment.family,
    experiment.branch,
    experiment.tip,
    experiment.verdict,
    recordedReasonText(experiment.reason),
    experiment.protocolId ?? '',
    experiment.hypothesis ?? '',
    experiment.capital ?? '',
    experiment.auditClass,
  ].join(' ').toLocaleUpperCase('en-US');
}

export function selectResearchLabExperiments(
  experiments: readonly ResearchLabExperiment[],
  filter: ResearchLabFilter,
  query: string,
): readonly ResearchLabExperiment[] {
  const normalizedQuery = query.trim().toLocaleUpperCase('en-US');
  return experiments.filter((experiment) => {
    const outcome = researchLabOutcome(experiment);
    const filterMatch = filter === 'ALL'
      || filter === outcome
      || (filter === 'TERMINAL' && experiment.auditClass === TERMINAL_RESEARCH_AUDIT_CLASS);
    return filterMatch && (normalizedQuery.length === 0 || normalizedSearchText(experiment).includes(normalizedQuery));
  });
}

function recordedText(value: string | null | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : 'NONE_RECORDED';
}

export function projectResearchLabDetail(experiment: ResearchLabExperiment): ResearchLabDetail {
  return Object.freeze({
    family: experiment.family,
    verdict: experiment.verdict,
    reason: experiment.reason === null
      ? 'NONE_RECORDED'
      : JSON.stringify(experiment.reason, null, 2) ?? 'NONE_RECORDED',
    reasonStructured: experiment.reason !== null,
    protocolId: recordedText(experiment.protocolId),
    hypothesis: recordedText(experiment.hypothesis),
    capital: recordedText(experiment.capital),
    sourceBranch: experiment.branch,
    recordedTip: `${experiment.tip} · 12-Character Tip Prefix`,
    fileCount: `${experiment.files} Family File References`,
    auditClass: experiment.auditClass,
    auditCommits: experiment.auditCommits === null ? 'NONE_RECORDED' : String(experiment.auditCommits),
    custody: `${experiment.branch} @ ${experiment.tip}`,
    artifactAccess: 'No app-openable artifact path is recorded in the frozen index. Exact branch and tip custody is preserved as text.',
  });
}

export function isStandardResearchVerdict(verdict: string): boolean {
  return STANDARD_VERDICTS.has(verdict);
}
