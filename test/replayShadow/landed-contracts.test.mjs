import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanExecutableSnippet, scanSecretText } from '../i00/scope-security.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function filesUnder(relativeDirectory) {
  const files = [];
  const walk = (relativePath) => {
    for (const entry of readdirSync(path.join(ROOT, relativePath), { withFileTypes: true })) {
      const child = path.posix.join(relativePath, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN:${child}`);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk(relativeDirectory);
  return files.sort();
}

const corpus = readJson('fixtures/replayShadow/corpus.v1.json');

function dataset(datasetId) {
  const found = corpus.datasets.find((row) => row.datasetId === datasetId);
  assert.ok(found, `missing ${datasetId}`);
  return found;
}

test('landed replay and scenario owners remain the only generic adapters', () => {
  const replayIndex = read('server/src/foundation/replay/index.ts');
  const scenarioGenerator = read('server/src/foundation/scenarios/generator.ts');
  const entryGate = readJson('fixtures/replayShadow/entry-gate.v1.json');
  const harness = read('fixtures/replayShadow/harness.mjs');

  assert.match(replayIndex, /export \* from '\.\/replay\.js';/);
  assert.match(scenarioGenerator, /export function scenarioToReplayInputs\(/);
  assert.equal(
    entryGate.rows.find((row) => row.id === 'RS-EG-018').classification,
    'REJECT_DUPLICATE',
  );
  assert.deepEqual(
    [...harness.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]),
    ['node:crypto'],
  );
  assert.doesNotMatch(harness, /server\/src\/foundation\/replay|scenarioToReplayInputs/);
});

test('raw restart, timestamp, fill, and soak facts stay outside incompatible landed contracts', () => {
  const streamOwner = read('server/src/binance/ws.ts');
  const timeOwner = read('server/src/foundation/contracts/time.ts');
  const fillOwner = read('server/src/foundation/reconciliation/types.ts');
  const capacityOwner = read('server/src/intelligenceRuntime/capacity/types.ts');
  const restart = dataset('RS-DATA-RESTART-STORM-001');
  const stale = dataset('RS-DATA-STALE-001');
  const partial = dataset('RS-DATA-PARTIAL-AMBIGUITY-001');
  const soak = corpus.campaigns.find((row) => row.campaignId === 'RS-CAMPAIGN-SOAK-001');

  assert.match(streamOwner, /maximumAttempts: 8,/);
  assert.equal(
    Math.max(...restart.eventTape
      .filter((event) => event.type === 'RESTART_REQUEST_RECORDED')
      .map((event) => event.facts.attempt)),
    9,
  );
  assert.equal(restart.ownerReference.ownerId, 'UNMOUNTED_POLICY_VIOLATION_OBSERVATION');

  assert.match(timeOwner, /COMPLETENESS_STATES = \['COMPLETE', 'PARTIAL', 'UNAVAILABLE'\]/);
  assert.match(timeOwner, /MAX_UTC_MS = 4_102_444_800_000/);
  assert.match(timeOwner, /rec\.maxAgeMs <= 0/);
  assert.equal(stale.eventTape.some((event) => event.facts.completeness === 'UNKNOWN'), true);

  assert.match(fillOwner, /tradeId: string;/);
  assert.match(fillOwner, /price: number \| null;/);
  const ambiguousReport = partial.eventTape
    .filter((event) => event.type === 'EXECUTION_REPORT_OBSERVED')
    .at(-1);
  assert.deepEqual(
    [ambiguousReport.facts.tradeId, ambiguousReport.facts.lastPrice],
    [null, null],
  );
  assert.equal(typeof ambiguousReport.facts.cumulativeQuantity, 'string');

  assert.match(capacityOwner, /maximumDurationMs: 300_000/);
  assert.equal(soak.schedule.measurementDurationMs, 21_600_000);
  assert.equal(soak.executionState, 'DEFERRED_POST_C2_OTHER_MACHINE');
});

test('current fault identifiers resolve as typed catalog entries', () => {
  const faultOwner = read('server/src/productAssurance/faults/harness.ts');
  const canonicalIds = new Set(
    [...faultOwner.matchAll(/^\s*\['(FAULT_[A-Z0-9_]+)'/gm)].map((match) => match[1]),
  );

  assert.equal(canonicalIds.size >= corpus.faultRefs.length, true);
  for (const reference of corpus.faultRefs) assert.equal(canonicalIds.has(reference.scenarioId), true);
});

test('the live-execution barrier remains canonical and the port adds no executable authority', () => {
  const constants = read('server/src/systemIntegration/contracts/constants.ts');
  const laneFiles = [
    ...filesUnder('fixtures/replayShadow'),
    ...filesUnder('test/replayShadow'),
  ];

  assert.match(
    constants,
    /export const LIVE_EXECUTION_NOT_IMPLEMENTED = 'LIVE_EXECUTION_NOT_IMPLEMENTED' as const;/,
  );
  for (const relativePath of laneFiles.filter((value) => value.endsWith('.mjs'))) {
    assert.deepEqual(scanExecutableSnippet(read(relativePath)), [], relativePath);
  }
});

test('every present lane artifact is a regular, secret-free file inside the ratified namespaces', () => {
  const laneFiles = [
    ...filesUnder('fixtures/replayShadow'),
    ...filesUnder('test/replayShadow'),
  ];

  assert.equal(laneFiles.length >= 8, true);
  assert.equal(new Set(laneFiles).size, laneFiles.length);
  assert.equal(laneFiles.every((value) => (
    value.startsWith('fixtures/replayShadow/') || value.startsWith('test/replayShadow/')
  )), true);
  for (const relativePath of laneFiles) {
    assert.deepEqual(scanSecretText(read(relativePath)), [], relativePath);
  }
});
