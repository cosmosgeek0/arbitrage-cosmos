import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  RESEARCH_LAB_DATASET_PROVENANCE,
  TERMINAL_RESEARCH_AUDIT_CLASS,
  decodeResearchLabExperiment,
  parseResearchLabIndex,
  projectResearchLabDetail,
  researchLabCounts,
  selectResearchLabExperiments,
} from '../../src/data/researchLab.ts';
import {
  RESEARCH_LAB_ARTIFACTS,
  RESEARCH_LAB_ARTIFACT_PROVENANCE,
} from '../../src/data/researchLabArtifacts.ts';
import {
  RESEARCH_LAB_ARTIFACT_MAX_BYTES,
  artifactsForRequestFamily,
  canonicalResearchArtifact,
  loadResearchArtifact,
} from '../../src/pages/research-lab/researchLabArtifactClient.ts';
import {
  RESEARCH_LAB_BE2_WINDOW_END,
  parseResearchLabStoryLayer,
  researchLabGateComparisonIdentity,
  researchLabGateRows,
} from '../../src/data/researchLabEvidence.ts';
import { parseRoutePath, routeTarget, serializeRoute } from '../../src/store.tsx';

const datasetUrl = new URL('../../src/data/RESEARCH_LAB_INDEX.json', import.meta.url);
const storiesUrl = new URL('../../src/data/researchLabStories.json', import.meta.url);

async function frozenIndex() {
  const bytes = await readFile(datasetUrl);
  const payload = JSON.parse(bytes.toString('utf8'));
  return { bytes, experiments: parseResearchLabIndex(payload), payload };
}

test('versioned frozen index retains the source bytes, provenance, and exact family counts', async () => {
  const { bytes, experiments } = await frozenIndex();
  // apply_patch creates a POSIX text-file terminator. Strip that single byte
  // before comparing with the immutable Desktop source's recorded byte hash.
  const sourceBytes = bytes.at(-1) === 0x0a ? bytes.subarray(0, -1) : bytes;
  assert.equal(sourceBytes.byteLength, RESEARCH_LAB_DATASET_PROVENANCE.sourceBytes);
  assert.equal(
    createHash('sha256').update(sourceBytes).digest('hex'),
    RESEARCH_LAB_DATASET_PROVENANCE.sourceSha256,
  );

  const counts = researchLabCounts(experiments);
  assert.deepEqual(counts, {
    all: 84,
    noGo: 21,
    unmeasured: 23,
    noneRecorded: 38,
    special: 2,
    terminal: 49,
    fileReferences: 1_112,
  });
  assert.equal(new Set(experiments.map(({ family }) => family)).size, 84);
  assert.equal(new Set(experiments.map(({ branch, tip }) => `${branch}@${tip}`)).size, 82);
});

test('missing verdicts remain NONE_RECORDED and every outcome filter is exact', async () => {
  const { experiments, payload } = await frozenIndex();
  const missingVerdict = { ...payload[0] };
  delete missingVerdict.verdict;
  assert.equal(decodeResearchLabExperiment(missingVerdict).verdict, 'NONE_RECORDED');

  assert.equal(selectResearchLabExperiments(experiments, 'ALL', '').length, 84);
  assert.equal(selectResearchLabExperiments(experiments, 'NO_GO', '').length, 21);
  assert.equal(selectResearchLabExperiments(experiments, 'UNMEASURED', '').length, 23);
  assert.equal(selectResearchLabExperiments(experiments, 'NONE_RECORDED', '').length, 38);
  assert.deepEqual(
    selectResearchLabExperiments(experiments, 'SPECIAL', '').map(({ family, verdict }) => [family, verdict]),
    [
      ['s1u', 'NO_GO_DEVELOPMENT_HOLDOUT_UNOPENED'],
      ['s1v', 'UNMEASURED_RUN_CONSUMED_NO_RERUN'],
    ],
  );
  const terminal = selectResearchLabExperiments(experiments, 'TERMINAL', '');
  assert.equal(terminal.length, 49);
  assert.ok(terminal.every(({ auditClass }) => auditClass === TERMINAL_RESEARCH_AUDIT_CLASS));
});

test('preserved artifact manifest is complete and the viewer fails closed on forged or changed bytes', async () => {
  assert.equal(RESEARCH_LAB_ARTIFACTS.length, RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedFiles);
  assert.equal(
    new Set(RESEARCH_LAB_ARTIFACTS.map(({ family }) => family)).size,
    RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedFamilies,
  );
  assert.equal(
    RESEARCH_LAB_ARTIFACTS.reduce((sum, artifact) => sum + artifact.bytes, 0),
    RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedBytes,
  );

  for (const artifact of RESEARCH_LAB_ARTIFACTS) {
    const bytes = await readFile(new URL(`../../public/research-lab/${artifact.path}`, import.meta.url));
    assert.equal(bytes.byteLength, artifact.bytes, artifact.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.path);
  }

  const artifact = RESEARCH_LAB_ARTIFACTS[0];
  const bytes = await readFile(new URL(`../../public/research-lab/${artifact.path}`, import.meta.url));
  const controller = new AbortController();
  const loaded = await loadResearchArtifact(artifact, controller.signal, {
    baseUrl: 'http://localhost/research-lab',
    fetcher: async () => new Response(bytes),
  });
  assert.equal(loaded.verifiedBytes, artifact.bytes);
  assert.equal(loaded.verifiedSha256, artifact.sha256);

  const forged = { ...artifact, sha256: '0'.repeat(64) };
  assert.throws(() => canonicalResearchArtifact(forged), /RESEARCH_LAB_ARTIFACT_NOT_ALLOWLISTED/);
  assert.throws(
    () => artifactsForRequestFamily('wrong-family', [artifact]),
    /RESEARCH_LAB_ARTIFACT_FAMILY_MISMATCH/,
  );

  const changed = Buffer.from(bytes);
  changed[0] ^= 0xff;
  await assert.rejects(
    loadResearchArtifact(artifact, controller.signal, {
      baseUrl: 'http://localhost/research-lab',
      fetcher: async () => new Response(changed),
    }),
    /RESEARCH_LAB_ARTIFACT_SHA256_MISMATCH/,
  );
  await assert.rejects(
    loadResearchArtifact(artifact, controller.signal, {
      baseUrl: 'http://localhost/research-lab',
      fetcher: async () => new Response(new Uint8Array(0), {
        headers: { 'content-length': String(RESEARCH_LAB_ARTIFACT_MAX_BYTES + 1) },
      }),
    }),
    /RESEARCH_LAB_ARTIFACT_SIZE_OUT_OF_BOUNDS/,
  );
});

test('artifact-derived story layer preserves 72 authored families and be2 remains in progress', async () => {
  const { experiments } = await frozenIndex();
  const payload = JSON.parse(await readFile(storiesUrl, 'utf8'));
  const layer = parseResearchLabStoryLayer(payload, experiments);
  assert.equal(layer.status, 'READY');
  assert.deepEqual(layer.counts, {
    total: 72,
    artifactDerived: 57,
    artifactsInsufficient: 14,
    inProgress: 1,
    indexNarratives: 12,
  });
  assert.match(layer.provenance, /ARTIFACTS_INSUFFICIENT/);
  assert.equal(layer.stories.filter(({ kind }) => kind === 'ARTIFACTS_INSUFFICIENT').length, 14);
  const be2 = layer.stories.find(({ family }) => family === 'be2');
  assert.equal(be2.kind, 'IN_PROGRESS');
  assert.match(be2.whyItEnded, /It has not ended and no outcome is recorded/);
  assert.equal(RESEARCH_LAB_BE2_WINDOW_END, '2026-08-12T00:00:00Z (exclusive)');

  const manifestCitations = new Set(
    RESEARCH_LAB_ARTIFACTS.map(({ path }) => `web/public/research-lab/${path}`),
  );
  for (const story of layer.stories) {
    for (const source of story.sources) {
      assert.doesNotMatch(source, /^\/Users\//u);
      if (story.family === 'verdict-normalization') {
        assert.match(source, /^web\/public\/research-lab\/ \(manifest custody:/u);
      } else {
        assert.ok(manifestCitations.has(source), `${story.family}: ${source}`);
      }
    }
  }
});

test('search and detail projection expose recorded evidence without inventing an app-open control', async () => {
  const { experiments } = await frozenIndex();
  const [vg17] = selectResearchLabExperiments(experiments, 'NO_GO', '4f196ec08260');
  assert.equal(vg17.family, 'vg17');

  const detail = projectResearchLabDetail(vg17);
  assert.equal(detail.family, 'vg17');
  assert.equal(detail.verdict, 'NO_GO');
  assert.equal(detail.sourceBranch, 'codex/vg17-impact-efficiency-1be1-019faead');
  assert.equal(detail.recordedTip, '4f196ec08260 · 12-Character Tip Prefix');
  assert.equal(detail.fileCount, '10 Family File References');
  assert.match(detail.reason, /DEVELOPMENT_GATES_FAILED/);
  assert.match(detail.artifactAccess, /No app-openable artifact path is recorded/);
  assert.equal(detail.custody, 'codex/vg17-impact-efficiency-1be1-019faead @ 4f196ec08260');
});

test('gate-array projection preserves eleven exact gate records and compares arrays by code identity', async () => {
  const payload = {
    developmentGates: Array.from({ length: 11 }, (_, index) => ({
      name: `GATE_${String(index + 1).padStart(2, '0')}`,
      pass: index % 3 === 0,
      observed: `OBSERVED_${index + 1}`,
      threshold: `THRESHOLD_${index + 1}`,
      ...(index % 2 === 0
        ? { reasonCode: `REASON_${index + 1}` }
        : { reason_code: `REASON_${index + 1}` }),
    })),
  };
  const rows = researchLabGateRows(payload);
  assert.equal(rows.length, 11);
  assert.deepEqual(
    rows.map(({ code, observed, threshold, reason }) => ({ code, observed, threshold, reason })),
    Array.from({ length: 11 }, (_, index) => ({
      code: `GATE_${String(index + 1).padStart(2, '0')}`,
      observed: `OBSERVED_${index + 1}`,
      threshold: `THRESHOLD_${index + 1}`,
      reason: `REASON_${index + 1}`,
    })),
  );

  const recordedS2k = JSON.parse(await readFile(
    new URL('../../public/research-lab/s2k/development.v1.json', import.meta.url),
    'utf8',
  ));
  const recordedRows = researchLabGateRows(recordedS2k);
  assert.equal(recordedRows.length, 11);
  assert.deepEqual(
    recordedRows.map(({ code, observed, threshold }) => ({ code, observed, threshold })),
    recordedS2k.gates.map(({ name, observed, threshold }) => ({
      code: name,
      observed: String(observed),
      threshold: String(threshold),
    })),
  );

  const left = researchLabGateRows({
    gateFailures: [
      { code: 'MAX_DRAWDOWN', status: 'FAIL' },
      { code: 'MIN_SAMPLE', status: 'FAIL' },
    ],
  });
  const right = researchLabGateRows({
    gateFailures: [
      { code: 'MIN_SAMPLE', status: 'FAIL' },
      { code: 'MAX_DRAWDOWN', status: 'FAIL' },
    ],
  });
  const leftByCode = new Map(left.map((row) => [row.code, researchLabGateComparisonIdentity(row)]));
  const rightByCode = new Map(right.map((row) => [row.code, researchLabGateComparisonIdentity(row)]));
  assert.equal(leftByCode.get('MAX_DRAWDOWN'), rightByCode.get('MAX_DRAWDOWN'));
  assert.equal(leftByCode.get('MIN_SAMPLE'), rightByCode.get('MIN_SAMPLE'));
  assert.notEqual(
    researchLabGateComparisonIdentity(left[0]),
    researchLabGateComparisonIdentity(right[0]),
    'different codes at the same array position must remain NOT_COMPARABLE',
  );
});

test('Research Lab retains one durable route contract', () => {
  assert.equal(serializeRoute(routeTarget('research-lab')), '/research-lab');
  assert.deepEqual(parseRoutePath('/research-lab').target, { page: 'research-lab', detailSymbol: null });
});
