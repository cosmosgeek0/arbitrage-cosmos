import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addTwinDecimals,
  compareTwinDecimals,
  divideTwinDecimals,
  minimumTwinDecimal,
  multiplyTwinDecimals,
  signedTwinResidual,
  subtractTwinDecimals,
  twinDecimal,
  twinPositiveDecimal,
} from '../../../dist/liveEdge/adapters/exchangeTwin/exact.js';

test('exchange twin arithmetic preserves exact decimal values', () => {
  assert.equal(twinDecimal('0001.2300'), '1.23');
  assert.equal(twinPositiveDecimal('0.00000001'), '0.00000001');
  assert.equal(addTwinDecimals('0.1', '0.2'), '0.3');
  assert.equal(subtractTwinDecimals('1', '0.99999999'), '0.00000001');
  assert.equal(multiplyTwinDecimals('123.45', '0.008'), '0.9876');
  assert.equal(minimumTwinDecimal('10.000', '9.999'), '9.999');
  assert.equal(compareTwinDecimals('1.000', '1'), 0);
  assert.equal(divideTwinDecimals('3', '2'), '1.5');
  assert.equal(signedTwinResidual('0.75', '1'), '-0.25');
});

test('exchange twin arithmetic rejects hostile, unsafe and optimistic values', () => {
  for (const value of [
    -1,
    1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '-0.1',
    '1e-3',
    ' 1',
    '',
    null,
    undefined,
    {},
  ]) {
    assert.throws(() => twinDecimal(value), /exact non-negative plain-decimal string/);
  }

  assert.throws(() => twinPositiveDecimal('0'), /must be positive/);
  assert.throws(() => subtractTwinDecimals('1', '2'), /would become negative/);
  assert.throws(() => divideTwinDecimals('1', '0'), /must be positive/);
});
