import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FROZEN_L_TRANSITION_CONFORMANCE_COMMIT,
  FROZEN_L_TRANSITION_CONFORMANCE_MODEL_IDS,
  FROZEN_L_TRANSITION_CONFORMANCE_SCHEMA,
  TRANSITION_CONFORMANCE_FIXTURES,
} from '../../../../fixtures/productAssurance/systemic/formal/fixtures/transition-conformance-fixtures.mjs';
import {
  CANONICAL_MODELS,
  exploreModel,
} from '../../../../fixtures/productAssurance/systemic/formal/explicitState/index.mjs';

const ACCEPTED_STATUSES = Object.freeze(['MAPPED', 'PARTIAL', 'ABSENT', 'UNREACHABLE']);
const EXPECTED_COMMIT = 'df6b472993ca9659ce09cf5f72004981c6835f0d';
const EXPECTED_HONESTY = Object.freeze({
  sourceTruth: 'SYNTHETIC_ONLY',
  authority: 'SUPPORTING_EVIDENCE_ONLY',
  runtimeClaimClosure: 'NOT_PERMITTED',
});

const sortText = (values) => [...values].sort((left, right) => left.localeCompare(right));
const key = (modelId, actionId) => `${modelId}\u0000${actionId}`;

test('M08-M13 frozen-L transition manifest accounts for every reachable canonical action exactly once', () => {
  assert.equal(FROZEN_L_TRANSITION_CONFORMANCE_SCHEMA, 'S3_FROZEN_L_TRANSITION_CONFORMANCE_V1');
  assert.equal(FROZEN_L_TRANSITION_CONFORMANCE_COMMIT, EXPECTED_COMMIT);
  assert.equal(Object.isFrozen(TRANSITION_CONFORMANCE_FIXTURES), true);

  const selectedModels = CANONICAL_MODELS.filter(
    (model) => FROZEN_L_TRANSITION_CONFORMANCE_MODEL_IDS.includes(model.modelId),
  );
  assert.deepEqual(
    selectedModels.map((model) => model.modelId),
    FROZEN_L_TRANSITION_CONFORMANCE_MODEL_IDS,
  );

  const reachable = selectedModels.flatMap((model) => {
    const coverage = exploreModel(model).exploration.actionCoverage;
    assert.equal(coverage.length > 0, true, `${model.modelId} has no reachable actions`);
    return coverage.map(({ actionId, count }) => {
      assert.equal(Number.isSafeInteger(count) && count > 0, true, `${model.modelId}:${actionId}`);
      return key(model.modelId, actionId);
    });
  });

  const seen = new Set();
  for (const row of TRANSITION_CONFORMANCE_FIXTURES) {
    assert.equal(Object.isFrozen(row), true, `${row.modelId}:${row.actionId}`);
    assert.deepEqual(Object.keys(row), [
      'modelId', 'actionId', 'frozenCommit', 'status', 'implementationRefs', 'honesty',
    ]);
    assert.equal(FROZEN_L_TRANSITION_CONFORMANCE_MODEL_IDS.includes(row.modelId), true, row.modelId);
    assert.match(row.actionId, /^[A-Z][A-Z0-9_]{1,95}$/u);
    assert.equal(row.frozenCommit, EXPECTED_COMMIT, `${row.modelId}:${row.actionId}`);
    assert.equal(ACCEPTED_STATUSES.includes(row.status), true, `${row.modelId}:${row.actionId}:${row.status}`);
    assert.notEqual(row.status, 'UNREACHABLE', `${row.modelId}:${row.actionId} is reachable by construction`);

    assert.equal(Array.isArray(row.implementationRefs), true);
    assert.equal(Object.isFrozen(row.implementationRefs), true);
    assert.equal(row.implementationRefs.length > 0, true, `${row.modelId}:${row.actionId}`);
    const refKeys = new Set();
    for (const implementationRef of row.implementationRefs) {
      assert.equal(Object.isFrozen(implementationRef), true);
      assert.deepEqual(Object.keys(implementationRef), ['path', 'symbol']);
      assert.match(implementationRef.path, /^server\/(?:src|test)\/.+\.(?:ts|mjs)$/u);
      assert.match(implementationRef.symbol, /^[A-Za-z_$][A-Za-z0-9_$.()]*$/u);
      const refKey = `${implementationRef.path}\u0000${implementationRef.symbol}`;
      assert.equal(refKeys.has(refKey), false, `${row.modelId}:${row.actionId}:${refKey}`);
      refKeys.add(refKey);
    }

    assert.equal(Object.isFrozen(row.honesty), true);
    assert.deepEqual(Object.keys(row.honesty), [
      'sourceTruth', 'authority', 'runtimeClaimClosure', 'note',
    ]);
    assert.equal(row.honesty.sourceTruth, EXPECTED_HONESTY.sourceTruth);
    assert.equal(row.honesty.authority, EXPECTED_HONESTY.authority);
    assert.equal(row.honesty.runtimeClaimClosure, EXPECTED_HONESTY.runtimeClaimClosure);
    assert.equal(typeof row.honesty.note, 'string');
    assert.equal(row.honesty.note.length > 24 && row.honesty.note.length <= 320, true);

    const rowKey = key(row.modelId, row.actionId);
    assert.equal(seen.has(rowKey), false, `duplicate transition mapping ${rowKey}`);
    seen.add(rowKey);
  }

  assert.equal(TRANSITION_CONFORMANCE_FIXTURES.length, reachable.length);
  assert.deepEqual(sortText(seen), sortText(reachable));
});
