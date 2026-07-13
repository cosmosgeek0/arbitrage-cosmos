import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE,
  COMPLETE_ASSURANCE_CASE_FIXTURE,
  FIXTURE_NOW_MS,
  buildS1AssumptionProjection,
  clonePlainData,
  evaluateAssuranceCase,
} from '../../../../fixtures/productAssurance/systemic/assuranceCase/index.mjs';

const evaluate = (packet, projection = ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE) => (
  evaluateAssuranceCase(packet, projection, FIXTURE_NOW_MS)
);

test('packet accessor is rejected without executing the getter', () => {
  let invoked = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'schemaVersion', {
    enumerable: true,
    get() {
      invoked += 1;
      return 'pa.s4.assurance-case.v1';
    },
  });
  const result = evaluate(hostile);
  assert.equal(invoked, 0);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('ASSURANCE_PACKET_CAPTURE_FAILED'));
});

test('hostile reflection proxy fails closed', () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error('reflection denied');
    },
  });
  const result = evaluate(hostile);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('ASSURANCE_PACKET_CAPTURE_FAILED'));
});

test('cyclic packet fails closed', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packet.self = packet;
  const result = evaluate(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.packetIssues.some((entry) => entry.code === 'PLAIN_DATA_CYCLE'));
});

test('unsafe integer timestamp fails plain-data capture', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packet.generatedAtMs = Number.MAX_SAFE_INTEGER + 1;
  const result = evaluate(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.packetIssues.some((entry) => entry.code === 'CAPTURE_NUMBER_INVALID'));
});

test('oversized evidence array is bounded and rejected', () => {
  const packet = clonePlainData(COMPLETE_ASSURANCE_CASE_FIXTURE);
  packet.evidence = Array.from({ length: 513 }, () => clonePlainData(packet.evidence[0]));
  const result = evaluate(packet);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.packetIssues.some((entry) => (
    entry.code === 'SCHEMA_EVIDENCE_ARRAY_INVALID'
    || entry.code === 'DUPLICATE_ID'
    || entry.code === 'CAPTURE_NODE_LIMIT'
  )));
});

test('S1 accessor input is rejected without invocation', () => {
  let invoked = 0;
  const projection = {};
  Object.defineProperty(projection, 'assumptionResults', {
    enumerable: true,
    get() {
      invoked += 1;
      return [];
    },
  });
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  assert.equal(invoked, 0);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('S1_PROJECTION_CAPTURE_FAILED'));
});

test('invalid S1 provenance cannot be used to support PASS', () => {
  const projection = clonePlainData(ACCEPTED_S1_ASSUMPTION_PROJECTION_FIXTURE);
  projection.provenance.schemaBlob = '0000000000000000000000000000000000000000';
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  assert.equal(result.status, 'UNKNOWN');
  assert(result.reasonCodes.includes('S1_PROJECTION_INVALID'));
});

test('future-dated accepted S1 projection fails closed without a future assurance deadline', () => {
  const projection = buildS1AssumptionProjection({ evaluatedAtMs: FIXTURE_NOW_MS + 1 });
  const result = evaluate(COMPLETE_ASSURANCE_CASE_FIXTURE, projection);
  assert.equal(result.status, 'UNKNOWN');
  assert.deepEqual(result.reasonCodes, ['S1_PROJECTION_FROM_FUTURE']);
  assert.equal(result.claimResults.length, 0);
  assert.equal(result.recomputation.assuranceDueAtMs, null);
  assert.equal(result.safetyBoundary.supportUsableForNewAction, false);
});
