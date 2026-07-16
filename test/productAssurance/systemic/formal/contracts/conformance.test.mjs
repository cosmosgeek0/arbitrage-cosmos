import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateConformanceMapping,
} from '../../../../../fixtures/productAssurance/systemic/formal/contracts/conformance.mjs';
import {
  CONFORMANCE_FIXTURES,
} from '../../../../../fixtures/productAssurance/systemic/formal/fixtures/conformance-fixtures.mjs';

test('conformance evaluation rejects an alternating mismatches getter without invoking it', () => {
  const candidate = { ...CONFORMANCE_FIXTURES[0] };
  let reads = 0;
  Object.defineProperty(candidate, 'mismatches', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return reads === 1 ? ['validation-visible mismatch'] : [];
    },
  });

  const evaluated = evaluateConformanceMapping(candidate);

  assert.equal(reads, 0);
  assert.equal(evaluated.verdict, 'UNKNOWN');
  assert.equal(evaluated.runtimeClaimClosure, 'NOT_PERMITTED');
  assert.equal(evaluated.mappingId, null);
  assert.equal(evaluated.modelId, null);
  assert.deepEqual(evaluated.reasons, ['CONFORMANCE_INPUT_INVALID']);
  assert.equal(evaluated.issues.some((issue) => issue.code === 'BOUNDARY_ACCESSOR_REJECTED'), true);
  assert.equal(evaluated.issues.some((issue) => issue.path === '$.mismatches'), true);
});

test('conformance evaluation rejects nested accessors before schema validation', () => {
  const candidate = JSON.parse(JSON.stringify(CONFORMANCE_FIXTURES[0]));
  let reads = 0;
  Object.defineProperty(candidate.replays.representativeSuccess, 'status', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return 'NOT_RUN';
    },
  });

  const evaluated = evaluateConformanceMapping(candidate);

  assert.equal(reads, 0);
  assert.equal(evaluated.verdict, 'UNKNOWN');
  assert.equal(evaluated.issues.some((issue) => issue.code === 'BOUNDARY_ACCESSOR_REJECTED'), true);
  assert.equal(evaluated.issues.some((issue) => issue.path === '$.replays.representativeSuccess.status'), true);
});

test('ordinary mutable conformance data is evaluated from a private snapshot', () => {
  const candidate = JSON.parse(JSON.stringify(CONFORMANCE_FIXTURES[0]));

  const evaluated = evaluateConformanceMapping(candidate);

  assert.equal(evaluated.verdict, 'MISMATCH');
  assert.equal(evaluated.mappingId, candidate.mappingId);
  assert.equal(evaluated.modelId, candidate.modelId);
  assert.equal(Object.isFrozen(candidate), false);
  assert.equal(Object.isFrozen(candidate.mismatches), false);
});

test('an accessor-bearing verification context cannot suppress an authenticated mismatch', () => {
  const candidate = CONFORMANCE_FIXTURES[0];
  let reads = 0;
  const context = {};
  Object.defineProperty(context, 'verificationAuthority', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return 'INDEPENDENT_READBACK';
    },
  });

  const evaluated = evaluateConformanceMapping(candidate, context);

  assert.equal(reads, 0);
  assert.equal(evaluated.verdict, 'MISMATCH');
  assert.equal(evaluated.runtimeClaimClosure, 'NOT_PERMITTED');
  assert.equal(evaluated.reasons.includes('CONFORMANCE_CONTEXT_INVALID'), true);
  assert.equal(evaluated.reasons.includes('INDEPENDENT_VERIFICATION_AUTHORITY_MISSING'), true);
});
