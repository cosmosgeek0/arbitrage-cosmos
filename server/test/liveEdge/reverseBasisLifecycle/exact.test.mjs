import assert from 'node:assert/strict';
import test from 'node:test';

import {
  absoluteReverseBasisDifference,
  addReverseBasisDecimals,
  compareReverseBasisDecimals,
  reverseBasisDecimal,
  subtractReverseBasisFloorZero,
  sumReverseBasisDecimals,
} from '../../../dist/liveEdge/adapters/reverseBasisLifecycle/index.js';

test('reverse-basis exact decimals preserve principal plus interest without binary64', () => {
  assert.equal(addReverseBasisDecimals('0.03', '0.0001'), '0.0301');
  assert.equal(sumReverseBasisDecimals(['0.01', '0.02', '0.0001']), '0.0301');
});

test('remaining quantity floors at exact zero without becoming negative', () => {
  assert.equal(subtractReverseBasisFloorZero('0.03', '0.01'), '0.02');
  assert.equal(subtractReverseBasisFloorZero('0.03', '0.03'), '0');
  assert.equal(subtractReverseBasisFloorZero('0.03', '0.04'), '0');
});

test('hedge drift uses exact absolute difference', () => {
  assert.equal(absoluteReverseBasisDifference('0.03', '0.01'), '0.02');
  assert.equal(absoluteReverseBasisDifference('0.01', '0.03'), '0.02');
  assert.equal(absoluteReverseBasisDifference('0.03', '0.03'), '0');
});

test('comparison handles high precision canonical decimals', () => {
  assert.equal(compareReverseBasisDecimals('0.000000000000000000000001', '0'), 1);
  assert.equal(compareReverseBasisDecimals('999999999999999999.1', '999999999999999999.01'), 1);
  assert.equal(compareReverseBasisDecimals('1.000000000000000000000001', '1.000000000000000000000001'), 0);
});

test('noncanonical, negative and exponent values fail closed', () => {
  for (const value of ['01', '1.0', '+1', '-1', '1e-8', '', ' 1']) {
    assert.throws(() => reverseBasisDecimal(value), /canonical non-negative exact decimal|must be canonical/);
  }
});
