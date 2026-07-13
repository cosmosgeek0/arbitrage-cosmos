import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildCompleteHazardFixture } from '../../../../fixtures/productAssurance/systemic/hazard/index.mjs';

const generatedRoot = new URL('../../../../fixtures/productAssurance/systemic/hazard/generated/', import.meta.url);
const researchBasis = new URL('../../../../fixtures/productAssurance/systemic/hazard/RESEARCH_BASIS.md', import.meta.url);

const parseTableRows = (source, idPattern) => source
  .split('\n')
  .filter((line) => line.startsWith('|') && !line.includes('| ---'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
  .filter((cells) => idPattern.test(cells[0] ?? ''));

test('insertion requests are DRAFT, complete, non-authoritative rows', async () => {
  const source = await readFile(new URL('ASSURANCE_INSERTION_REQUEST.DRAFT.md', generatedRoot), 'utf8');
  const rows = parseTableRows(source, /^`PA-S1-IR-\d{3}`$/);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((cells) => cells[0]), Array.from({ length: 9 }, (_, index) => `\`PA-S1-IR-${String(index + 1).padStart(3, '0')}\``));
  for (const row of rows) {
    assert.equal(row.length, 10);
    assert.equal(row[1], 'DRAFT');
    assert.equal(row[9], '`NONE`');
    assert.notEqual(row[2], '');
    assert.notEqual(row[4], '');
    assert.notEqual(row[6], '');
    assert.notEqual(row[7], '');
  }
  for (const heading of ['Canonical owner', 'Target seam', 'Reason', 'Contract', 'Required tests', 'Expected behavior', 'Authority effect']) {
    assert.match(source, new RegExp(heading));
  }
});

test('every exact S1 proof gap has an insertion request', async () => {
  const source = await readFile(new URL('ASSURANCE_INSERTION_REQUEST.DRAFT.md', generatedRoot), 'utf8');
  const gapCodes = buildCompleteHazardFixture().hazards
    .filter((hazard) => hazard.proof.kind === 'PROOF_GAP')
    .map((hazard) => hazard.proof.gapCode)
    .sort();
  assert.equal(gapCodes.length, 4);
  for (const gapCode of gapCodes) {
    assert.match(source, new RegExp(gapCode));
  }
});

test('catalog draft rows preserve tri-state and canonical-owner response boundaries', async () => {
  const source = await readFile(new URL('SAFETY_INVARIANT_CATALOG_ROWS.DRAFT.md', generatedRoot), 'utf8');
  const rows = parseTableRows(source, /^`PA-S1-CAT-\d{3}`$/);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.length === 11));
  assert.match(source, /`PASS`\/`FAIL`\/`UNKNOWN`|`FAIL` or `UNKNOWN`/);
  assert.match(source, /canonical owners decide machine response/i);
  assert.match(source, /NOT INSERTED/);
});

test('autonomy rows cannot be mistaken for integrated or live proof', async () => {
  const source = await readFile(new URL('AUTONOMY_CLOSURE_REPORT_ROWS.DRAFT.md', generatedRoot), 'utf8');
  assert.match(source, /DRAFT · SYNTHETIC_ONLY · NOT INSERTED/);
  assert.match(source, /actual release `MISSING`/);
  assert.match(source, /DIRECTOR_MOUNT_REQUIRED/);
  assert.match(source, /do not claim `WIRED`, `INTEGRATED`, `LIVE`/);
});

test('research basis cites only informative primary sources and keeps local law binding', async () => {
  const source = await readFile(researchBasis, 'utf8');
  assert.match(source, /MIT Partnership for Systems Approaches to Safety and Security/);
  assert.match(source, /NIST.*SP 800-160 Vol\. 1 Rev\. 1/);
  assert.match(source, /NASA Office of Safety and Mission Assurance/);
  assert.match(source, /informative design checks only/);
  assert.match(source, /No fixture or test performs network access/);
});
