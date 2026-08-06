import { researchLabOutcome, type ResearchLabExperiment, type ResearchLabOutcome } from './researchLab';
import { RESEARCH_LAB_ARTIFACTS } from './researchLabArtifacts';

export type ResearchLabFamilyType = 'VOLUME' | 'FUNDING' | 'GAP' | 'DATA_QUALITY' | 'OTHER_UNCLASSIFIED';
export type ResearchLabTypeVerdicts = Readonly<{
  type: ResearchLabFamilyType;
  label: string;
  total: number;
  noGo: number;
  unmeasured: number;
  noneRecorded: number;
  special: number;
}>;

const FUNDING_FAMILIES = new Set([
  's1g', 's1j', 's1k', 's1m', 's1n', 's1o',
  's1q', 's1r', 's1s', 's1t', 's1v', 's1w',
]);
const FAMILY_TYPE_ORDER: readonly ResearchLabFamilyType[] = Object.freeze([
  'VOLUME', 'FUNDING', 'GAP', 'DATA_QUALITY', 'OTHER_UNCLASSIFIED',
]);
const FAMILY_TYPE_LABELS: Readonly<Record<ResearchLabFamilyType, string>> = Object.freeze({
  VOLUME: 'Volume',
  FUNDING: 'Funding',
  GAP: 'Gap',
  DATA_QUALITY: 'Data Quality',
  OTHER_UNCLASSIFIED: 'Other / Unclassified',
});

export function researchLabFamilyType(family: string): ResearchLabFamilyType {
  if (/^vg\d+$/u.test(family) || family === 've1' || family === 've2' || family === 'volume-economics') return 'VOLUME';
  if (/^dq\d+$/u.test(family)) return 'DATA_QUALITY';
  if (family === 's2h') return 'GAP';
  if (FUNDING_FAMILIES.has(family)) return 'FUNDING';
  return 'OTHER_UNCLASSIFIED';
}

export function researchLabVerdictsByType(experiments: readonly ResearchLabExperiment[]): readonly ResearchLabTypeVerdicts[] {
  const rows = FAMILY_TYPE_ORDER.map((type) => {
    const familyRows = experiments.filter((experiment) => researchLabFamilyType(experiment.family) === type);
    const counts = { noGo: 0, unmeasured: 0, noneRecorded: 0, special: 0 };
    for (const experiment of familyRows) {
      const outcome: ResearchLabOutcome = researchLabOutcome(experiment);
      if (outcome === 'NO_GO') counts.noGo += 1;
      else if (outcome === 'UNMEASURED') counts.unmeasured += 1;
      else if (outcome === 'NONE_RECORDED') counts.noneRecorded += 1;
      else counts.special += 1;
    }
    return Object.freeze({ type, label: FAMILY_TYPE_LABELS[type], total: familyRows.length, ...counts });
  });
  const expected = [
    [39, 16, 13, 10, 0],
    [12, 1, 5, 5, 1],
    [1, 0, 0, 1, 0],
    [13, 0, 0, 13, 0],
    [19, 4, 5, 9, 1],
  ];
  if (
    experiments.length === 84
    && rows.some((row, index) => [
      row.total, row.noGo, row.unmeasured, row.noneRecorded, row.special,
    ].some((count, countIndex) => count !== expected[index]?.[countIndex]))
  ) {
    throw new TypeError('RESEARCH_LAB_FAMILY_TYPE_ANALYTICS_INTEGRITY_INVALID');
  }
  return Object.freeze(rows);
}

export type ResearchLabRecordedTime = Readonly<{
  family: string;
  artifactPath: string;
  field: string;
  recordedAtUtc: string;
}>;

export const RESEARCH_LAB_RECORDED_TIMES: readonly ResearchLabRecordedTime[] = Object.freeze([
  {"family":"s1f","artifactPath":"s1f/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T01:37:00Z"},
  {"family":"s1i","artifactPath":"s1i/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T17:13:34Z"},
  {"family":"s1l","artifactPath":"s1l/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T16:38:51.437643Z"},
  {"family":"s1q","artifactPath":"s1q/result.v1.json","field":"created_at","recordedAtUtc":"2026-07-29T16:43:30.720262Z"},
  {"family":"s1r","artifactPath":"s1r/result.v1.json","field":"createdAt","recordedAtUtc":"2026-07-29T17:18:25.586145Z"},
  {"family":"s1s","artifactPath":"s1s/result.v1.json","field":"sealedAt","recordedAtUtc":"2026-07-29T17:27:48.645873Z"},
  {"family":"s1v","artifactPath":"s1v/result.v1.json","field":"created_at","recordedAtUtc":"2026-07-29T19:54:19.980340Z"},
  {"family":"s1y","artifactPath":"s1y/result.v1.json","field":"created_at","recordedAtUtc":"2026-07-29T19:34:56.131938Z"},
  {"family":"s2k","artifactPath":"s2k/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T20:26:26Z"},
  {"family":"vg10","artifactPath":"vg10/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T21:33:14Z"},
  {"family":"vg15","artifactPath":"vg15/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T17:08:33Z"},
  {"family":"vg16","artifactPath":"vg16/result.v1.json","field":"generatedAtUtc","recordedAtUtc":"2026-07-29T17:34:13Z"},
  {"family":"vg17","artifactPath":"vg17/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T17:06:32Z"},
  {"family":"vg18","artifactPath":"vg18/result.v1.json","field":"createdAt","recordedAtUtc":"2026-07-29T17:22:59Z"},
  {"family":"vg19","artifactPath":"vg19/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T17:07:24.839759Z"},
  {"family":"vg2","artifactPath":"vg2/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T15:56:59.000Z"},
  {"family":"vg20","artifactPath":"vg20/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T16:55:49.516Z"},
  {"family":"vg21","artifactPath":"vg21/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T16:58:38.496Z"},
  {"family":"vg22","artifactPath":"vg22/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T17:30:05.315Z"},
  {"family":"vg23","artifactPath":"vg23/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T17:57:08Z"},
  {"family":"vg24","artifactPath":"vg24/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T18:23:30.371Z"},
  {"family":"vg25","artifactPath":"vg25/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T18:33:44Z"},
  {"family":"vg26","artifactPath":"vg26/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T18:13:39Z"},
  {"family":"vg27","artifactPath":"vg27/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T20:21:50Z"},
  {"family":"vg28","artifactPath":"vg28/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T18:40:25.240077Z"},
  {"family":"vg29","artifactPath":"vg29/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T18:28:07Z"},
  {"family":"vg3","artifactPath":"vg3/result.v1.json","field":"resultCreatedAtUtc","recordedAtUtc":"2026-07-29T18:04:24Z"},
  {"family":"vg30","artifactPath":"vg30/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T18:47:40Z"},
  {"family":"vg35","artifactPath":"vg35/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T18:58:35Z"},
  {"family":"vg38","artifactPath":"vg38/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T19:39:48Z"},
  {"family":"vg4","artifactPath":"vg4/result.v1.json","field":"createdAtUtc","recordedAtUtc":"2026-07-29T16:02:48Z"},
  {"family":"vg6","artifactPath":"vg6/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T16:42:23.144Z"},
  {"family":"vg8","artifactPath":"vg8/result.v1.json","field":"completedAtUtc","recordedAtUtc":"2026-07-29T16:33:19Z"},
]);

export type ResearchLabTimeBucket = Readonly<{ hour: string; count: number }>;
export function researchLabRecordedTimeBuckets(experiments: readonly ResearchLabExperiment[]): Readonly<{
  dated: number;
  unknown: number;
  buckets: readonly ResearchLabTimeBucket[];
}> {
  const admitted = new Set(experiments.map((experiment) => experiment.family));
  const rows = RESEARCH_LAB_RECORDED_TIMES.filter((entry) => admitted.has(entry.family));
  const counts = new Map<string, number>();
  for (const entry of rows) {
    const hour = entry.recordedAtUtc.slice(11, 13);
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return Object.freeze({
    dated: rows.length,
    unknown: Math.max(0, experiments.length - rows.length),
    buckets: Object.freeze([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([hour, count]) => Object.freeze({ hour, count }),
    )),
  });
}

const shippedArtifactPaths = new Set(RESEARCH_LAB_ARTIFACTS.map((artifact) => artifact.path));
if (
  RESEARCH_LAB_RECORDED_TIMES.length !== 33
  || new Set(RESEARCH_LAB_RECORDED_TIMES.map((row) => row.family)).size !== 33
  || RESEARCH_LAB_RECORDED_TIMES.some((row) => !shippedArtifactPaths.has(row.artifactPath))
) {
  throw new TypeError('RESEARCH_LAB_TIME_ANALYTICS_INTEGRITY_INVALID');
}
