import test from 'node:test';
import assert from 'node:assert/strict';

import * as capitalSurface from '../../../dist/capitalFoundation/index.js';
import { OPPORTUNITY_CONFLICT_KINDS } from '../../../dist/capitalFoundation/opportunities/types.js';

const HOSTILE_VALUE = '__CALLER_INJECTED_AUTHORITY__';

function exportedVocabularies() {
  const entries = Object.entries(capitalSurface)
    .filter(([name, value]) => /^[A-Z0-9_]+$/.test(name) && Array.isArray(value));
  if (!entries.some(([name]) => name === 'OPPORTUNITY_CONFLICT_KINDS')) {
    entries.push(['OPPORTUNITY_CONFLICT_KINDS', OPPORTUNITY_CONFLICT_KINDS]);
  }
  return entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

test('every exported Capital vocabulary is runtime-frozen against process-global widening', () => {
  const vocabularies = exportedVocabularies();
  assert.ok(vocabularies.length >= 34, `expected the complete vocabulary surface, received ${vocabularies.length}`);
  for (const [name, vocabulary] of vocabularies) {
    const original = [...vocabulary];
    assert.equal(Object.isFrozen(vocabulary), true, `${name} must be runtime-frozen`);
    assert.throws(() => vocabulary.push(HOSTILE_VALUE), TypeError, `${name} accepted caller mutation`);
    assert.deepEqual(vocabulary, original, `${name} changed after hostile mutation`);
  }
});

test('hostile mutation attempts cannot widen action, stage, or lifecycle validators', () => {
  assert.throws(() => capitalSurface.POSITION_ACTION_INTENTS.push(HOSTILE_VALUE), TypeError);
  assert.ok(capitalSurface.validatePositionActionIntent({ kind: HOSTILE_VALUE }).includes('ACTION_KIND_UNKNOWN'));
  assert.throws(() => capitalSurface.CAPITAL_STAGES.push(HOSTILE_VALUE), TypeError);
  assert.throws(() => capitalSurface.canTransitionCapitalStage('OBSERVE', HOSTILE_VALUE), /unknown stage/);
  assert.throws(() => capitalSurface.CAPITAL_LIFECYCLE_STATES.push(HOSTILE_VALUE), TypeError);
  assert.equal(capitalSurface.isCapitalLifecycleState(HOSTILE_VALUE), false);
});
