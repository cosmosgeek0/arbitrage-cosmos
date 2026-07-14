import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  projectExternalProofEvidence,
} from '../../../dist/liveEdge/adapters/externalProofEvidence/index.js';
import { completeInput } from './fixtures.mjs';

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/externalProofEvidence');
const ALLOWED_IMPORTS = new Set([
  '../../../foundation/contracts/index.js',
  '../exposureRecoveryProjection/index.js',
  '../machineGraphEvidence/index.js',
  '../binanceInstrumentSpecs/index.js',
  './projection.js',
  './types.js',
]);

test('adapter source imports only narrow evidence owners and has no ambient/action boundary', () => {
  const sources = fs.readdirSync(SOURCE_ROOT)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => [name, fs.readFileSync(path.join(SOURCE_ROOT, name), 'utf8')]);
  assert.deepEqual(sources.map(([name]) => name), ['index.ts', 'projection.ts', 'types.ts']);

  for (const [name, source] of sources) {
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(imports.every((specifier) => ALLOWED_IMPORTS.has(specifier)), `${name}: ${imports}`);
    for (const forbidden of [
      /\bnode:/, /\bprocess\.env\b/, /\bMath\.random\s*\(/,
      /\b(?:fetch|setTimeout|setInterval|queueMicrotask)\s*\(/,
      /\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/,
      /\b(?:borrow|repay|withdraw|transfer|placeOrder|createOrder|testOrder|signRequest)\s*\(/,
    ]) assert.doesNotMatch(source, forbidden, `${name}: ${forbidden}`);
  }
});

test('projection performs no ambient fetch, timer, or randomness call', () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalRandom = Math.random;
  let calls = 0;
  const forbidden = () => { calls += 1; throw new Error('ambient boundary called'); };
  try {
    globalThis.fetch = forbidden;
    globalThis.setTimeout = forbidden;
    Math.random = forbidden;
    const snapshot = projectExternalProofEvidence(completeInput());
    assert.equal(snapshot.externalCalls, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    Math.random = originalRandom;
  }
});

test('FILTER_BLOCKED source allowlist excludes canonical owner gaps and arithmetic inability', () => {
  const source = fs.readFileSync(path.join(SOURCE_ROOT, 'projection.ts'), 'utf8');
  const allowlist = source.match(/const FILTER_ARITHMETIC_REASON = ([^;]+);/)?.[1] ?? '';
  assert.notEqual(allowlist, '');
  for (const excluded of [
    'BLOCKED_OWNER_TRUTH',
    'INSTRUMENT_REVISION_MISMATCH',
    'TIME_IN_FORCE_NOT_ADVERTISED',
    'FILTER_REFERENCE_EVIDENCE_REQUIRED',
    'FILTER_REFERENCE_EVIDENCE_REJECTED',
    'FILTER_SCALE_UNSUPPORTED',
  ]) assert.doesNotMatch(allowlist, new RegExp(excluded));
  assert.match(source, /EXCHANGE_FILTER_REASON/);
  assert.match(source, /reasonCodes\.some\(\(reason\) => EXCHANGE_FILTER_REASON\.test\(reason\)\)/);
});
