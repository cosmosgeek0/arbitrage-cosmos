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
import { parseRoutePath, routeTarget, serializeRoute } from '../../src/store.tsx';

const datasetUrl = new URL('../../src/data/RESEARCH_LAB_INDEX.json', import.meta.url);
const sourceUrl = (path) => new URL(`../../src/${path}`, import.meta.url);

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

test('Research Lab is mounted at one durable read-only route with compact navigation discovery', async () => {
  const [page, app, header, palette] = await Promise.all([
    readFile(sourceUrl('pages/ResearchLab.tsx'), 'utf8'),
    readFile(sourceUrl('App.tsx'), 'utf8'),
    readFile(sourceUrl('components/Header.tsx'), 'utf8'),
    readFile(sourceUrl('components/Palette.tsx'), 'utf8'),
  ]);

  assert.equal(serializeRoute(routeTarget('research-lab')), '/research-lab');
  assert.deepEqual(parseRoutePath('/research-lab').target, { page: 'research-lab', detailSymbol: null });
  assert.match(app, /page === ['"]research-lab['"] && <ResearchLab \/>/);
  assert.match(header, /id: ['"]research-lab['"], label: ['"]Research Lab['"]/);
  assert.match(palette, /page: ['"]research-lab['"], name: ['"]Research Lab['"]/);

  assert.doesNotMatch(page, /href=|window\.open|fetch\(['"]\/api|WebSocket/);
  assert.doesNotMatch(page, />\s*(?:Run|Approve|Deploy|Execute|Trade|Buy|Sell|Withdraw|Credential)\b/iu);
  assert.match(page, /aria-expanded=\{expanded\}/);
  assert.match(page, /role="group"/);
  assert.match(page, /aria-pressed=\{filter === item\.id\}/);
});
