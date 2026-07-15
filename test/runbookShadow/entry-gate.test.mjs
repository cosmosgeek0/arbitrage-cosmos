import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { BASE_SHA, entryGateDocument, ROOT } from './lib/constants.mjs';

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function listFiles(relativePath) {
  const output = [];
  for (const entry of readdirSync(path.join(ROOT, relativePath), { withFileTypes: true })) {
    const child = path.posix.join(relativePath, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(child));
    else output.push(child);
  }
  return output.sort();
}

test('immutable base, branch, directive, and preverify inputs match the entry gate', () => {
  const gate = entryGateDocument();
  assert.equal(gate.baseSha, BASE_SHA);
  assert.equal(git('branch', '--show-current'), gate.branch);
  assert.equal(git('rev-parse', `${BASE_SHA}^{tree}`), 'e665f37197ffff97a5973e60777c99e60b6e7ea2');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', BASE_SHA, 'HEAD'], { cwd: ROOT }).status, 0);
  assert.equal(git('cat-file', '-t', gate.authorityEvidence.directiveCommit), 'commit');
  assert.equal(git('rev-parse', `${gate.authorityEvidence.directiveCommit}^{tree}`), gate.authorityEvidence.directiveTree);
  assert.equal(git('rev-parse', `${gate.authorityEvidence.directiveCommit}:QL_DIRECTOR_STATE.md`), gate.authorityEvidence.directorStateBlob);
  assert.equal(git('rev-parse', `${gate.authorityEvidence.directiveCommit}:WORKER_PROMPTS.md`), gate.authorityEvidence.workerPromptsBlob);
  assert.equal(gate.authorityEvidence.directive, 'D-LAUNCH-37');
  assert.equal(gate.authorityEvidence.order, '90dcac299155');
  const directorState = git('show', `${gate.authorityEvidence.directiveCommit}:QL_DIRECTOR_STATE.md`);
  const workerPrompts = git('show', `${gate.authorityEvidence.directiveCommit}:WORKER_PROMPTS.md`);
  assert(directorState.includes('## D-LAUNCH-37 (2026-07-15): second acceleration order (90dcac299155)'));
  assert(directorState.includes('outputs SHADOW_SPECULATIVE, no acceptance status'));
  assert(workerPrompts.includes('## RUN-19 — folder /Users/cosmosgeek/Desktop/runbook-shadow'));
  assert(workerPrompts.includes('TASK: RUNBOOK-SHADOW — executable zero-capital owner drills'));
  assert(workerPrompts.includes('Stop at RUNBOOK_SHADOW_READY or BLOCKED.'));
  assert.equal(git('rev-parse', 'refs/heads/preverify-20260714'), gate.authorityEvidence.preverifyCommit);
  assert.equal(git('rev-parse', `${gate.authorityEvidence.preverifyOwnerPrepCommit}:ownerPrep`), gate.authorityEvidence.preverifyOwnerPrepTree);
  assert.equal(git('rev-parse', `${gate.authorityEvidence.preverifyCommit}:ownerPrep`), gate.authorityEvidence.preverifyOwnerPrepTree);

  const immutableRows = git('ls-tree', '-r', gate.authorityEvidence.preverifyOwnerPrepCommit, 'ownerPrep')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
      assert(match, line);
      return { path: match[2], blob: match[1] };
    });
  assert.equal(immutableRows.length, 19);
  const classifiedRows = gate.preverifyInputs
    .map(({ path: inputPath, blob }) => ({ path: inputPath, blob }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.deepEqual(
    classifiedRows,
    immutableRows.sort((left, right) => left.path.localeCompare(right.path, 'en')),
  );
});

test('every proposed build is classified and confined to the two exclusive roots', () => {
  const gate = entryGateDocument();
  const allowed = new Set(['ADOPT_EXISTING', 'ADAPT_EXISTING', 'MISSING_BUILD', 'REFERENCE_ONLY', 'REJECT_DUPLICATE']);
  assert.equal(new Set(gate.proposedItems.map((item) => item.id)).size, gate.proposedItems.length);
  assert.equal(new Set(gate.draftProposedItems.map((item) => item.id)).size, gate.draftProposedItems.length);
  assert(gate.preverifyInputs.every((item) => allowed.has(item.classification)));
  assert(gate.draftProposedItems.every((item) => allowed.has(item.classification)));
  assert(gate.proposedItems.every((item) => allowed.has(item.classification)));

  const allProposals = [...gate.proposedItems, ...gate.draftProposedItems];
  const buildRows = allProposals.filter((item) => item.buildPath !== undefined);
  for (const item of buildRows) {
    assert(gate.buildableClassifications.includes(item.classification));
    assert(
      item.buildPath.startsWith('fixtures/runbookShadow/')
        || item.buildPath.startsWith('test/runbookShadow/'),
      item.buildPath,
    );
  }
  for (const item of allProposals.filter((candidate) => !gate.buildableClassifications.includes(candidate.classification))) {
    assert.equal(item.buildPath, undefined);
  }

  const files = [...listFiles('fixtures/runbookShadow'), ...listFiles('test/runbookShadow')];
  for (const file of files) {
    assert(buildRows.some(({ buildPath }) => file === buildPath || file.startsWith(`${buildPath}/`)), `unclassified generated path ${file}`);
  }
});
