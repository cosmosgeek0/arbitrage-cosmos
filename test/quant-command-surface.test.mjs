import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  QUANT_COMMAND_MODES,
  QUANT_PACKAGE_SCRIPTS,
  QUANT_PYTEST_SELECTORS,
  QUANT_RESEARCH_COMMANDS,
  resolveQuantCommand,
  validatePytestReport,
} from './quant-command-contract.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNNER = path.join(ROOT, 'test/run-quant-gates.mjs');

test('Q-133 package surface exposes all fourteen modes through the sole Quant runner', () => {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['test:quant:built'], 'node test/run-quant-gates.mjs');
  assert.deepEqual(Object.keys(QUANT_PACKAGE_SCRIPTS), QUANT_COMMAND_MODES.map((mode) => `quant:${mode}`));
  for (const [script, mode] of Object.entries(QUANT_PACKAGE_SCRIPTS)) {
    assert.equal(packageJson.scripts[script], `node test/run-quant-gates.mjs ${mode}`);
    assert.doesNotMatch(packageJson.scripts[script], /(?:pytest|ruff|mypy|quant-edge|\.venv)/u);
  }
  assert.deepEqual(
    readdirSync(path.join(ROOT, 'test')).filter((name) => name.startsWith('run-quant-')).sort(),
    ['run-quant-gates.mjs'],
  );
});

test('Q-133 command parsing rejects unknown and multiple modes before child execution', () => {
  assert.equal(resolveQuantCommand([]), 'canonical');
  for (const mode of QUANT_COMMAND_MODES) assert.equal(resolveQuantCommand([mode]), mode);
  assert.throws(() => resolveQuantCommand(['unknown']), /QUANT_COMMAND_INVALID/u);
  assert.throws(() => resolveQuantCommand(['lint', 'typecheck']), /QUANT_COMMAND_INVALID/u);

  for (const arguments_ of [['unknown'], ['lint', 'typecheck']]) {
    const result = spawnSync(process.execPath, [RUNNER, ...arguments_], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 2);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^QUANT_COMMAND_INVALID:/u);
    assert.doesNotMatch(result.stderr, /Quant gate:/u);
  }
});

test('Q-133 pytest categories preserve the accepted Q17 selectors without marker false greens', () => {
  assert.deepEqual(Object.keys(QUANT_PYTEST_SELECTORS), [
    'test:unit',
    'test:property',
    'test:contract',
    'test:leakage',
    'test:replay',
    'test:integration',
    'test:benchmark',
    'test:all',
  ]);
  assert.deepEqual(QUANT_PYTEST_SELECTORS['test:unit'], ['tests/unit']);
  assert.ok(QUANT_PYTEST_SELECTORS['test:property'].includes('tests/q14/test_q14_properties.py'));
  assert.ok(QUANT_PYTEST_SELECTORS['test:contract'].includes('tests/q16/test_q16_protocol.py'));
  assert.deepEqual(QUANT_PYTEST_SELECTORS['test:benchmark'], ['tests/q17/test_benchmark.py']);
  for (const selectors of Object.values(QUANT_PYTEST_SELECTORS)) {
    assert.ok(selectors.length > 0);
    assert.equal(new Set(selectors).size, selectors.length);
    assert.equal(selectors.some((selector) => selector.startsWith('-m')), false);
  }
});

test('Q-133 JUnit receipts derive exact counts and fail closed on false-green reports', () => {
  const good = validatePytestReport({
    totals: { tests: 3, passed: 2, failures: 0, errors: 0, skipped: 1 },
    skips: [{ nodeid: 'tests/q08/test_scope.py::test_scope', message: 'shard only' }],
  }, {
    allowedSkips: new Map([['tests/q08/test_scope.py::test_scope', 'shard only']]),
    requireEveryAllowedSkip: true,
  });
  assert.deepEqual(good, { tests: 3, passed: 2, failures: 0, errors: 0, skipped: 1 });

  const reports = [
    { totals: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0 }, skips: [] },
    { totals: { tests: 2, passed: 2, failures: 1, errors: 0, skipped: 0 }, skips: [] },
    { totals: { tests: 1, passed: 0, failures: 1, errors: 0, skipped: 0 }, skips: [] },
    { totals: { tests: 1, passed: 0, failures: 0, errors: 1, skipped: 0 }, skips: [] },
    {
      totals: { tests: 1, passed: 0, failures: 0, errors: 0, skipped: 1 },
      skips: [{ nodeid: 'unexpected', message: 'not allowed' }],
    },
  ];
  for (const report of reports) assert.throws(() => validatePytestReport(report));
  assert.throws(() => validatePytestReport({
    totals: { tests: 1, passed: 1, failures: 0, errors: 0, skipped: 0 },
    skips: [],
  }, {
    allowedSkips: new Map([['expected', 'reason']]),
    requireEveryAllowedSkip: true,
  }), /EXPECTED_SKIP_MISSING/u);
});

test('Q-133 research modes own exactly three temporary byte-comparison outputs each', () => {
  assert.deepEqual(Object.keys(QUANT_RESEARCH_COMMANDS), [
    'research:baseline',
    'research:walk-forward',
  ]);
  for (const command of Object.values(QUANT_RESEARCH_COMMANDS)) {
    assert.match(command.program, /\.py$/u);
    assert.equal(command.artifacts.length, 3);
    assert.equal(new Set(command.artifacts).size, command.artifacts.length);
    for (const artifact of command.artifacts) {
      assert.equal(path.isAbsolute(artifact), false);
      assert.doesNotMatch(artifact, /(?:^|\/)\.\.(?:\/|$)/u);
    }
  }
});
