import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  projectFinalLaneEvidence,
} from '../../../dist/liveEdge/adapters/finalLaneEvidence/index.js';
import { completeInput } from './fixtures.mjs';

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/finalLaneEvidence');
const ALLOWED_IMPORTS = new Set([
  '../../../foundation/contracts/index.js',
  '../exposureRecoveryProjection/index.js',
  '../machineGraphEvidence/index.js',
  '../externalProofEvidence/index.js',
  './projection.js',
  './types.js',
]);

test('source is the exact narrow evidence-only adapter and imports no ambient/action owner', () => {
  const sources = fs.readdirSync(SOURCE_ROOT)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => [name, fs.readFileSync(path.join(SOURCE_ROOT, name), 'utf8')]);
  assert.deepEqual(sources.map(([name]) => name), ['index.ts', 'projection.ts', 'types.ts']);

  for (const [name, source] of sources) {
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.every((specifier) => ALLOWED_IMPORTS.has(specifier)), `${name}: ${imports}`);
    for (const forbidden of [
      /\bnode:/, /\bprocess(?:\.env)?\b/, /\bMath\.random\s*\(/,
      /\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/,
      /\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/,
      /\b(?:borrow|repay|withdraw|transfer|placeOrder|createOrder|testOrder|signRequest)\s*\(/,
      /\b(?:readFile|writeFile|execFile|spawn|deploy|restart|rollback)\s*\(/,
    ]) assert.doesNotMatch(source, forbidden, `${name}: ${forbidden}`);
  }
});

test('import and projection invoke no ambient fetch, timer, randomness, process, Git or filesystem seam', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  const originalRandom = Math.random;
  let calls = 0;
  const forbidden = () => { calls += 1; throw new Error('ambient boundary called'); };
  try {
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    globalThis.setInterval = forbidden;
    Math.random = forbidden;
    await import(new URL(
      '../../../dist/liveEdge/adapters/finalLaneEvidence/index.js?l17-inert-import=1',
      import.meta.url,
    ).href);
    const snapshot = projectFinalLaneEvidence(completeInput());
    assert.equal(snapshot.externalCalls, false);
    assert.equal(snapshot.filesystemAccess, false);
    assert.equal(snapshot.gitAccess, false);
    assert.equal(snapshot.environmentAccess, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
    Math.random = originalRandom;
  }
});

test('source exposes no runner, control, readiness, deployment or money-action authority', () => {
  const source = fs.readdirSync(SOURCE_ROOT)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => fs.readFileSync(path.join(SOURCE_ROOT, name), 'utf8'))
    .join('\n');
  for (const required of [
    "runnerAuthority: 'NONE'",
    "controlAuthority: 'NONE'",
    "deploymentAuthority: 'NONE'",
    "restartAuthority: 'NONE'",
    "readinessAuthority: 'NONE'",
    "actionAuthority: 'NONE'",
    'sendEligible: false',
    "liveExecution: 'LIVE_EXECUTION_NOT_IMPLEMENTED'",
    'productionReadinessProof: false',
    'laneReadyProof: false',
    'moneyMutationProof: false',
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
