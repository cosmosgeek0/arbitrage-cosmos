import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINAL_LANE_ACCEPTED_IDENTITIES,
  FINAL_LANE_COMMAND_SPECS,
  projectFinalLaneEvidence,
} from '../../../dist/liveEdge/adapters/finalLaneEvidence/index.js';
import { completeInput } from './fixtures.mjs';

function reject(mutator, pattern = /L17|scope|command|evidence|revision|schema|identity/i) {
  const input = completeInput();
  mutator(input);
  assert.throws(() => projectFinalLaneEvidence(input), pattern);
}

test('requires every exact passing command in canonical order', () => {
  reject((input) => input.commands.splice(3, 1), /complete exact L17 acceptance gate/);
  reject((input) => input.commands.reverse(), /exact passing revision-bound/);
  reject((input) => { input.commands[2].exitCode = 1; }, /exact passing revision-bound/);
  reject((input) => { input.commands[3].command = 'node --test'; }, /exact passing revision-bound/);
  reject((input) => { input.commands[0].unexpected = true; }, /exact closed schema/);
  assert.equal(completeInput().commands.length, FINAL_LANE_COMMAND_SPECS.length);
});

test('binds every command to the exact lowercase L17 implementation revision', () => {
  for (const bad of ['', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(64), 'not-a-commit']) {
    reject((input) => { input.implementationRevision = bad; }, /implementationRevision/);
  }
  for (const index of [0, 3, 10, 17]) {
    reject((input) => { input.commands[index].sourceRevision = 'f'.repeat(40); }, /revision-bound/);
  }
});

test('rejects forged, missing, fabricated and cross-gate-incoherent assertion counts', () => {
  reject((input) => { input.commands[0].assertions = 0; }, /accepted owner gate/);
  reject((input) => { input.commands[2].assertions = 1; }, /must not fabricate/);
  reject((input) => { input.commands[4].assertions = 5; }, /accepted owner gate/);
  reject((input) => { input.commands[6].assertions = 23; }, /accepted owner gate/);
  reject((input) => { input.commands[14].assertions = 378; }, /accepted owner gate/);
  reject((input) => { input.commands[15].assertions = 2_480; }, /accepted owner gate/);
  reject((input) => { input.commands[3].assertions += 1; }, /accepted owner gate/);
  reject((input) => { input.commands[5].assertions += 1; }, /accepted owner gate/);
});

test('requires one exact final scope proof and binds it to the final command instant', () => {
  reject((input) => { input.scopeGate.mode = 'WORKTREE'; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.branch = 'current-main'; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.knownAnchor = 'f'.repeat(40); }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.selectedBaseline = 'not-a-commit'; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.selectedBaseline = 'f'.repeat(40); }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.checkedRevision = 'f'.repeat(40); }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.gateScriptSha256 = 'f'.repeat(64); }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.gateTestSha256 = 'f'.repeat(64); }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.anchorIsAncestor = false; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.baselineOnFirstParent = false; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.baselineHasTwoParents = false; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.baselineSubjectHasExactDirectorPrefix = false; }, /final D-LAUNCH-16/);
  reject((input) => {
    input.scopeGate.classifierCryptographicallyAuthenticatesAuthorship = true;
  }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.violations.push('forbidden'); }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.workerCommitCount = 0; }, /positive/);
  reject((input) => { input.scopeGate.committedPathObservations = 0; }, /positive/);
  reject((input) => { input.commands.at(-1).verifiedAtMs -= 1; }, /strictly later/);
});

test('requires exact protected directive bytes and clean final worktree facts', () => {
  reject((input) => input.scopeGate.protectedInputs.pop(), /exact two protected/);
  reject((input) => { input.scopeGate.protectedInputs[0].sha256 = 'f'.repeat(64); }, /protected inputs/);
  reject((input) => { input.scopeGate.protectedInputs[0].regularFile = false; }, /protected inputs/);
  reject((input) => { input.scopeGate.protectedInputs[0].symlink = true; }, /protected inputs/);
  reject((input) => { input.scopeGate.protectedInputs[0].untracked = false; }, /protected inputs/);
  reject((input) => { input.scopeGate.protectedInputs[0].unstaged = false; }, /protected inputs/);
  reject((input) => { input.scopeGate.trackedDirtyPathCount = 1; }, /final D-LAUNCH-16/);
  reject((input) => { input.scopeGate.nonProtectedUntrackedPathCount = 1; }, /final D-LAUNCH-16/);
});

test('binds the complete accepted ruling, L12, L13, L15 and L16 identity chain', () => {
  for (const key of Object.keys(FINAL_LANE_ACCEPTED_IDENTITIES)) {
    reject((input) => {
      input.identities[key] = typeof input.identities[key] === 'number'
        ? input.identities[key] + 1
        : 'f'.repeat(String(input.identities[key]).length);
    }, /exact accepted/);
  }
  reject((input) => { input.identities.unexpected = true; }, /exact closed schema/);
});

test('rollback, backup/restore, canary preflight and real canary remain exact non-performance evidence', () => {
  reject(
    (input) => input.operationalEvidence.pop(),
    /rollback, backup\/restore, canary preflight and real canary/,
  );
  reject((input) => input.operationalEvidence.reverse(), /non-performance truth/);
  reject((input) => { input.operationalEvidence[0].performed = true; }, /non-performance truth/);
  reject((input) => { input.operationalEvidence[1].proofState = 'PRESENT'; }, /non-performance truth/);
  reject((input) => { input.operationalEvidence[2].reasonCodes = ['CANARY_PASSED']; }, /non-performance truth/);
  reject((input) => { input.operationalEvidence[3].performed = true; }, /non-performance truth/);
  reject((input) => { input.operationalEvidence[0].unexpected = 'claim'; }, /exact closed schema/);
});

test('rejects chronology violations across L16, scope, commands and operational facts', () => {
  reject((input) => { input.evaluatedAtMs = input.l16Snapshot.evaluatedAtMs - 1; }, /cannot predate/);
  reject((input) => { input.scopeGate.checkedAtMs = input.evaluatedAtMs + 1; }, /lineage window/);
  reject((input) => { input.scopeGate.checkedAtMs -= 1; }, /one exact seal instant/);
  reject((input) => { input.commands[0].verifiedAtMs = input.l16Snapshot.evaluatedAtMs - 1; }, /lineage window/);
  reject((input) => { input.commands[3].verifiedAtMs -= 2; }, /canonical nondecreasing/);
  reject((input) => { input.operationalEvidence[0].checkedAtMs = input.evaluatedAtMs + 1; }, /lineage window/);
  reject((input) => { input.operationalEvidence[0].checkedAtMs -= 1; }, /final scope instant/);
});

test('rejects unsafe, inherited, accessor, hidden, symbol, sparse, cyclic and oversized data', () => {
  reject((input) => { input.loop = input; }, /cycles/);
  reject((input) => { Object.setPrototypeOf(input.scopeGate, { inherited: true }); }, /plain objects/);
  reject((input) => {
    Object.defineProperty(input.scopeGate, 'hidden', { enumerable: false, value: true });
  }, /accessors and hidden fields/);
  reject((input) => {
    Object.defineProperty(input.commands[0], 'check', { enumerable: true, get: () => 'SERVER_BUILD' });
  }, /accessors and hidden fields/);
  reject((input) => { input.scopeGate[Symbol('claim')] = true; }, /symbol fields/);
  reject((input) => { input.commands = new Array(18); }, /sparse/);
  reject((input) => { input.apiKey = 'x'.repeat(32); }, /sensitive field/);
  reject((input) => { input.claim = 'api_key=' + 'x'.repeat(32); }, /secret-shaped/);
  reject((input) => { input.claim = 'x'.repeat(16_385); }, /oversized string/);
});
