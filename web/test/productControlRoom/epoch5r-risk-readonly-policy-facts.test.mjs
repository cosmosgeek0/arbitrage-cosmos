import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [riskSource, riskStyles] = await Promise.all([
  readFile(new URL('../../src/pages/Risk.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/pages/Risk.css', import.meta.url), 'utf8'),
]);

const limitsStart = riskSource.indexOf('<h2>Limits</h2>');
const limitsEnd = riskSource.indexOf('<h2>Symbol Policy</h2>', limitsStart);
assert.notEqual(limitsStart, -1, 'Risk Limits section is missing');
assert.notEqual(limitsEnd, -1, 'Risk Limits section does not terminate at Symbol Policy');
const limitsSource = riskSource.slice(limitsStart, limitsEnd);

const limitsDefinitionStart = riskSource.indexOf('const LIMIT_FIELDS');
const limitsDefinitionEnd = riskSource.indexOf('const STAGE_LABELS', limitsDefinitionStart);
assert.notEqual(limitsDefinitionStart, -1, 'Risk limit definitions are missing');
assert.notEqual(limitsDefinitionEnd, -1, 'Risk limit definitions do not terminate at stage labels');
const limitsDefinitionSource = riskSource.slice(limitsDefinitionStart, limitsDefinitionEnd);

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return riskStyles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

test('Epoch 5R Risk renders six policy values as non-interactive facts', () => {
  assert.deepEqual(
    [...limitsDefinitionSource.matchAll(/\bkey: '([^']+)'/g)].map((match) => match[1]),
    [
      'maxOrderNotionalUsd',
      'maxDailyNotionalUsd',
      'maxDailyLossUsd',
      'maxOpenOrders',
      'cooldownSec',
      'staleOrderMaxMin',
    ],
  );

  assert.match(limitsSource, /className="riskx-limit-row" role="row"/);
  assert.match(limitsSource, /riskx-limit-fact/);
  assert.match(limitsSource, /' unavailable'/);
  assert.match(limitsSource, /<small>OWNER_GATED<\/small>/);
  assert.match(limitsSource, /Owner gated; control preview required\./);
  assert.doesNotMatch(
    limitsSource,
    /<(?:a|button|input|label|select|textarea)\b|type="number"|readOnly|disabled|placeholder=|contentEditable|on[A-Z][A-Za-z]*=|role="(?:button|combobox|slider|spinbutton|switch|textbox)"|tabIndex=/,
  );
  assert.doesNotMatch(riskSource, /riskx-limit-input/);
});

test('Epoch 5R Risk policy facts keep unavailable and owner-gated posture non-green', () => {
  const factRule = rule('.riskx-limit-fact');
  const ownerGateRule = rule('.riskx-limit-fact small');
  const unavailableRule = rule('.riskx-limit-fact.unavailable strong');

  assert.notEqual(factRule, '', 'Risk fact presentation rule is missing');
  assert.doesNotMatch(factRule, /border|background|cursor/);
  assert.match(rule('.riskx-limit-head + .riskx-limit-row'), /border-top:\s*0/);
  assert.match(rule('.riskx-limit-fact em'), /min-width:\s*46px/);
  assert.match(ownerGateRule, /color:\s*var\(--down\)/);
  assert.match(unavailableRule, /color:\s*var\(--down\)/);
  assert.doesNotMatch(`${ownerGateRule}\n${unavailableRule}`, /var\(--up\)/);
});
