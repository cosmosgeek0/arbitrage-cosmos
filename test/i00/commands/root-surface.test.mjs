import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const testAllBuilt = readFileSync(resolve(ROOT, 'test/run-test-all-built.mjs'), 'utf8');

test('root exposes the stable I00 command surface without an install lifecycle hook', () => {
  const required = [
    'build', 'start', 'dev', 'validate:config', 'smoke:public',
    'smoke:private-read', 'smoke:signed-test', 'backup', 'restore:test',
    'release:preflight', 'deploy:preflight', 'rollback:preflight',
    'test:i00:commands', 'test:i00:performance', 'test:i00:complete',
  ];
  for (const command of required) assert.equal(typeof pkg.scripts[command], 'string', command);
  assert.equal(Object.hasOwn(pkg.scripts, 'install'), false);
});

test('public smoke uses the real server workspace build and private paths remain data-only', () => {
  assert.match(pkg.scripts['smoke:public'], /^npm run build -w server && node /);
  assert.doesNotMatch(pkg.scripts['smoke:public'], /build:server/);
  assert.equal(pkg.scripts['smoke:private-read'], 'node test/i00/owner-gated-command.mjs PRIVATE_READ');
  assert.equal(pkg.scripts['smoke:signed-test'], 'node test/i00/owner-gated-command.mjs SIGNED_TEST');
});

test('test:all includes focused command contracts exactly once', () => {
  assert.equal(pkg.scripts['test:all:built'], 'node test/run-test-all-built.mjs');
  const occurrences = testAllBuilt.split("'test:i00:commands'").length - 1;
  assert.equal(occurrences, 1);
});

test('performance root command selects measured run mode explicitly', () => {
  assert.equal(pkg.scripts['test:i00:performance'], 'node test/i00/performance/local-proxy-soak.mjs --run');
});

test('ops root commands target only the stable validation dispatcher', () => {
  for (const command of ['backup', 'restore:test', 'release:preflight', 'deploy:preflight', 'rollback:preflight']) {
    assert.match(pkg.scripts[command], /^node test\/i00\/ops-command\.mjs /);
    assert.doesNotMatch(pkg.scripts[command], /switch|systemctl|aws/i);
  }
});
