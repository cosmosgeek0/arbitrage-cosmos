export const QUANT_COMMAND_MODES = Object.freeze([
  'lint',
  'typecheck',
  'test:unit',
  'test:property',
  'test:contract',
  'test:replay',
  'test:leakage',
  'test:integration',
  'test:benchmark',
  'test:all',
  'research:baseline',
  'research:walk-forward',
  'registry:verify',
  'protocol:verify',
]);

export const QUANT_PACKAGE_SCRIPTS = Object.freeze(Object.fromEntries(
  QUANT_COMMAND_MODES.map((mode) => [`quant:${mode}`, mode]),
));

export const QUANT_PYTEST_SELECTORS = Object.freeze({
  'test:unit': Object.freeze(['tests/unit']),
  'test:property': Object.freeze([
    'tests/property',
    'tests/q08/test_q08_properties.py',
    'tests/q09/test_q09_properties.py',
    'tests/q11/test_q11_properties.py',
    'tests/q14/test_q14_properties.py',
  ]),
  'test:contract': Object.freeze([
    'tests/contract',
    'tests/q09/test_q09_contracts.py',
    'tests/q11/test_q11_contracts.py',
    'tests/q13/test_q13_contracts.py',
    'tests/q15/test_q15_contracts_artifacts.py',
    'tests/q16/test_q16_artifacts_pipeline.py',
    'tests/q16/test_q16_protocol.py',
  ]),
  'test:leakage': Object.freeze([
    'tests/unit/test_q05_*.py',
    'tests/property/test_q05_properties.py',
    'tests/contract/test_q05_*.py',
    'tests/q14',
  ]),
  'test:replay': Object.freeze([
    'tests/unit/test_q04_*.py',
    'tests/property/test_q04_book_properties.py',
    'tests/contract/test_q04_*.py',
    'tests/q17/test_replay_faults.py',
  ]),
  'test:integration': Object.freeze([
    'tests/q16',
    'tests/q17/test_component_manifest.py',
    'tests/q17/test_evidence.py',
    'tests/q17/test_generation.py',
  ]),
  'test:benchmark': Object.freeze(['tests/q17/test_benchmark.py']),
  'test:all': Object.freeze(['tests']),
});

export const QUANT_RESEARCH_COMMANDS = Object.freeze({
  'research:baseline': Object.freeze({
    program: 'scripts/q10_model_campaign.py',
    artifacts: Object.freeze([
      'fixtures/q10_model_golden_v1.json',
      'generated/q10/model_campaign.v1.json',
      'generated/q10/model_campaign.v1.md',
    ]),
  }),
  'research:walk-forward': Object.freeze({
    program: 'tests/q14/q14_validation_campaign.py',
    artifacts: Object.freeze([
      'generated/q14/q14_validation_golden_v1.json',
      'generated/q14/validation_campaign.v1.json',
      'generated/q14/validation_campaign.v1.md',
    ]),
  }),
});

export function resolveQuantCommand(arguments_) {
  if (!Array.isArray(arguments_)) throw new TypeError('QUANT_COMMAND_ARGUMENTS_INVALID');
  if (arguments_.length === 0) return 'canonical';
  if (arguments_.length !== 1 || !QUANT_COMMAND_MODES.includes(arguments_[0])) {
    throw new TypeError(`QUANT_COMMAND_INVALID:${arguments_.join(',')}`);
  }
  return arguments_[0];
}

export function validatePytestReport(report, {
  allowedSkips = new Map(),
  requireEveryAllowedSkip = false,
} = {}) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('QUANT_PYTEST_REPORT_INVALID');
  }
  const totals = report.totals;
  const skips = report.skips;
  if (totals === null || typeof totals !== 'object' || Array.isArray(totals) || !Array.isArray(skips)) {
    throw new TypeError('QUANT_PYTEST_REPORT_SHAPE_INVALID');
  }
  const fields = ['tests', 'passed', 'failures', 'errors', 'skipped'];
  for (const field of fields) {
    if (!Number.isSafeInteger(totals[field]) || totals[field] < 0) {
      throw new TypeError(`QUANT_PYTEST_TOTAL_INVALID:${field}`);
    }
  }
  if (totals.tests === 0) throw new TypeError('QUANT_PYTEST_ZERO_TESTS');
  if (totals.tests !== totals.passed + totals.failures + totals.errors + totals.skipped) {
    throw new TypeError('QUANT_PYTEST_TOTALS_INCOHERENT');
  }
  if (totals.failures !== 0 || totals.errors !== 0) {
    throw new TypeError(`QUANT_PYTEST_NONPASS:failures=${totals.failures}:errors=${totals.errors}`);
  }
  if (skips.length !== totals.skipped) throw new TypeError('QUANT_PYTEST_SKIP_TOTAL_INCOHERENT');

  const observedSkips = new Set();
  for (const skipped of skips) {
    const expectedReason = allowedSkips.get(skipped?.nodeid);
    if (typeof expectedReason !== 'string' || typeof skipped?.message !== 'string'
      || !skipped.message.includes(expectedReason)) {
      throw new TypeError(`QUANT_PYTEST_UNEXPECTED_SKIP:${String(skipped?.nodeid)}`);
    }
    if (observedSkips.has(skipped.nodeid)) {
      throw new TypeError(`QUANT_PYTEST_DUPLICATE_SKIP:${skipped.nodeid}`);
    }
    observedSkips.add(skipped.nodeid);
  }
  if (requireEveryAllowedSkip) {
    for (const expected of allowedSkips.keys()) {
      if (!observedSkips.has(expected)) throw new TypeError(`QUANT_PYTEST_EXPECTED_SKIP_MISSING:${expected}`);
    }
  }
  return Object.freeze({ ...totals });
}
