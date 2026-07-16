import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  BASE_SHA,
  entryGateDocument,
  insertionRequestDocument,
  ROOT,
} from './lib/constants.mjs';

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function gitLines(...args) {
  const output = git(...args);
  return output === '' ? [] : output.split('\n').filter(Boolean);
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

test('prestage-only assigned base, D-LAUNCH-51, sealed shadow, AIOPS-IR registry, and preverify inputs are immutable', () => {
  const gate = entryGateDocument();
  assert.equal(gate.packetId, 'PORT-RUNBOOK');
  assert.equal(gate.packetDisposition, 'POST_LANDING_PORT_PRESTAGE');
  assert.equal(gate.gateScope, 'PRESTAGE_ONLY');
  assert.equal(gate.integrationLimitations.length, 2);
  assert(gate.integrationLimitations.some((limitation) => limitation.includes('not clean-clone or post-landing root-mountable')));
  assert(gate.integrationLimitations.some((limitation) => limitation.includes('must not be registered unchanged')));
  assert.equal(gate.baseSha, BASE_SHA);
  assert.equal(git('branch', '--show-current'), gate.branch);
  assert.equal(git('rev-parse', `${BASE_SHA}^{tree}`), '3adef4d97ab595a8c81a307bac8dce22d037abdb');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', BASE_SHA, 'HEAD'], { cwd: ROOT }).status, 0);

  const authority = gate.authorityEvidence;
  assert.equal(git('cat-file', '-t', authority.directiveCommit), 'commit');
  assert.equal(git('rev-parse', `${authority.directiveCommit}^{tree}`), authority.directiveTree);
  assert.equal(git('rev-parse', `${authority.directiveCommit}:QL_DIRECTOR_STATE.md`), authority.directorStateBlob);
  assert.equal(git('rev-parse', `${authority.directiveCommit}:WORKER_PROMPTS.md`), authority.workerPromptsBlob);
  const directorState = git('show', `${authority.directiveCommit}:QL_DIRECTOR_STATE.md`);
  const workerPrompts = git('show', `${authority.directiveCommit}:WORKER_PROMPTS.md`);
  assert(directorState.includes('## D-LAUNCH-51 (2026-07-16): CI red diagnosed + post-landing burst launched (11 chats)'));
  assert(directorState.includes('port-ops/replay/obs/runbook'));
  assert(workerPrompts.includes('## CHAT 11 — folder /Users/cosmosgeek/Desktop/port-runbook'));
  assert(workerPrompts.includes('SOURCE: the SHADOW_SPECULATIVE artifact RUNBOOK drills (sealed 25a3762)'));
  assert(workerPrompts.includes('fixtures/runbookShadow/** + test/runbookShadow/**'));
  assert(workerPrompts.includes('stop at PORT_RUNBOOK_PRESTAGE_READY or precise BLOCKED.'));

  const source = gate.sourceEvidence;
  assert.equal(git('rev-parse', `refs/heads/${source.shadowBranch}`), source.shadowSealCommit);
  assert.equal(git('rev-parse', `${source.shadowSealCommit}^{tree}`), source.shadowSealTree);
  assert.equal(git('rev-parse', `${source.shadowSealCommit}^`), source.shadowImplementationCommit);
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', source.shadowPayloadBase, source.shadowSealCommit], { cwd: ROOT }).status, 0);
  assert.equal(git('rev-parse', `${source.shadowSealCommit}:${source.shadowReceiptPath}`), source.shadowReceiptBlob);
  const sourcePaths = gitLines('diff', '--name-only', `${source.shadowPayloadBase}..${source.shadowSealCommit}`);
  assert.equal(sourcePaths.length, source.changedPathCount);
  assert(sourcePaths.every((file) => source.sourcePathPrefixes.some((prefix) => file.startsWith(prefix))), sourcePaths);

  const registry = gate.registryEvidence;
  assert.equal(git('rev-parse', `refs/heads/${registry.branch}`), registry.commit);
  assert.equal(git('rev-parse', `${registry.commit}^{tree}`), registry.tree);
  assert.equal(git('rev-parse', `${registry.commit}:${registry.collisionMapPath}`), registry.collisionMapBlob);
  assert.equal(git('rev-parse', `${BASE_SHA}:${registry.schemaPath}`), registry.schemaBlob);
  const registryText = git('show', `${registry.commit}:${registry.collisionMapPath}`);
  assert(registryText.includes('Typed shared-owner insertion requests'));
  assert(registryText.includes('schema=InsertionRequestRowV1'));
  assert(registryText.includes('authorityCreated=false'));
  for (const request of insertionRequestDocument()) {
    const row = registryText.split('\n').find((line) => line.startsWith(`| \`${request.rowId}\``));
    assert(row, `missing immutable registry row ${request.rowId}`);
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim().replaceAll('`', ''));
    assert.equal(cells[2], request.requestedOwner, `${request.rowId}.requestedOwner`);
    assert.equal(cells[3], request.targetSeam, `${request.rowId}.targetSeam`);
    assert.equal(cells[4], request.reason, `${request.rowId}.reason`);
    assert.deepEqual([cells[5]], request.contract, `${request.rowId}.contract`);
    assert.deepEqual([cells[6]], request.tests, `${request.rowId}.tests`);
    assert.deepEqual([cells[7]], request.expectedBehavior, `${request.rowId}.expectedBehavior`);
  }

  assert.equal(git('rev-parse', `refs/heads/preverify-20260714`), authority.preverifyCommit);
  assert.equal(git('rev-parse', `${authority.preverifyOwnerPrepCommit}:ownerPrep`), authority.preverifyOwnerPrepTree);
  assert.equal(git('rev-parse', `${authority.preverifyCommit}:ownerPrep`), authority.preverifyOwnerPrepTree);
  const immutableRows = gitLines('ls-tree', '-r', authority.preverifyOwnerPrepCommit, 'ownerPrep')
    .map((line) => {
      const match = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
      assert(match, line);
      return { path: match[2], blob: match[1] };
    })
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const classifiedRows = gate.preverifyInputs
    .map(({ path: inputPath, blob }) => ({ path: inputPath, blob }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  assert.equal(immutableRows.length, 19);
  assert.deepEqual(classifiedRows, immutableRows);
});

test('every build is classified, deduplicated against landed owners, and confined to the ratified roots', () => {
  const gate = entryGateDocument();
  const allowed = new Set(['ADOPT_EXISTING', 'ADAPT_EXISTING', 'MISSING_BUILD', 'REFERENCE_ONLY', 'REJECT_DUPLICATE']);
  assert.equal(new Set(gate.proposedItems.map((item) => item.id)).size, gate.proposedItems.length);
  assert.equal(new Set(gate.draftProposedItems.map((item) => item.id)).size, gate.draftProposedItems.length);
  assert(gate.preverifyInputs.every((item) => allowed.has(item.classification)));
  assert(gate.draftProposedItems.every((item) => allowed.has(item.classification)));
  assert(gate.proposedItems.every((item) => allowed.has(item.classification)));

  assert.equal(new Set(gate.dedupEvidence.map((item) => item.concept)).size, gate.dedupEvidence.length);
  assert(gate.dedupEvidence.every((item) => ['ADOPT_EXISTING', 'ADAPT_EXISTING'].includes(item.classification)));
  assert(gate.dedupEvidence.every((item) => item.ownerPaths.length > 0 && item.provingTests.length > 0));
  for (const evidence of gate.dedupEvidence) {
    for (const ownerPath of [...evidence.ownerPaths, ...evidence.provingTests]) {
      const baseBlob = git('rev-parse', `${BASE_SHA}:${ownerPath}`);
      assert.match(baseBlob, /^[0-9a-f]{40}$/, `${evidence.concept}:${ownerPath}`);
      assert.equal(git('hash-object', ownerPath), baseBlob, `landed owner drift ${ownerPath}`);
    }
  }
  assert(gate.landedInterfaceReview.some((row) => row.assumption === 'canonical-production-restart-truth' && row.result === 'NOT_PROVEN_BY_RUNBOOK'));
  assert(gate.landedInterfaceReview.some((row) => row.assumption === 'operational-watchdog-rollback-restore' && row.result === 'NOT_INVOKED'));

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
