import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const FIXTURE_ROOT = path.resolve('fixtures/productAssurance/systemic/stability');
const TEST_ROOT = path.resolve('test/productAssurance/systemic/stability');
const ASSIGNED_ROOTS = Object.freeze([FIXTURE_ROOT, TEST_ROOT]);
const IMPORT_PURITY_TEST = path.join(TEST_ROOT, 'import-purity.test.mjs');

const TEST_NODE_IMPORTS = Object.freeze(new Set([
  'node:assert/strict',
  'node:test',
]));
const HARNESS_NODE_IMPORTS = Object.freeze(new Map([
  ['drafts.test.mjs', new Set(['node:fs'])],
  ['import-purity.test.mjs', new Set(['node:fs', 'node:path'])],
  ['scope.test.mjs', new Set(['node:child_process', 'node:fs', 'node:path'])],
]));

function moduleFiles(root) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...moduleFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) output.push(target);
  }
  return output.sort();
}

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function literalModuleSpecifiers(source) {
  const specifiers = [];
  const fromOrCall = /\b(?:from|import\s*\(|require\s*\()\s*(['"])([^'"\r\n]+)\1/g;
  const bareImport = /\bimport\s+(['"])([^'"\r\n]+)\1/g;
  for (const pattern of [fromOrCall, bareImport]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[2]);
  }
  return [...new Set(specifiers)].sort();
}

function assertLiteralModuleCalls(source, file) {
  const calls = /\b(?:import|require)\s*\(([\s\S]*?)\)/g;
  for (const match of source.matchAll(calls)) {
    assert.match(
      match[1],
      /^\s*(['"])[^'"]+\1\s*$/,
      `${file} uses a non-literal dynamic import or require`,
    );
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertAllowedSpecifier(file, specifier) {
  const relativeTestFile = isInside(TEST_ROOT, file) ? path.relative(TEST_ROOT, file) : null;
  if (specifier.startsWith('node:')) {
    assert.notEqual(relativeTestFile, null, `${file} imports Node capability ${specifier}`);
    const fileName = path.basename(file);
    const allowed = new Set([
      ...TEST_NODE_IMPORTS,
      ...(HARNESS_NODE_IMPORTS.get(fileName) ?? []),
    ]);
    assert.ok(allowed.has(specifier), `${file} imports forbidden Node capability ${specifier}`);
    return;
  }

  assert.ok(specifier.startsWith('.'), `${file} imports forbidden bare package or absolute target ${specifier}`);
  const pathOnly = specifier.split(/[?#]/, 1)[0];
  const resolved = path.resolve(path.dirname(file), pathOnly);
  assert.ok(existsSync(resolved), `${file} imports missing packet-local target ${specifier}`);
  const realResolved = realpathSync(resolved);
  assert.ok(
    ASSIGNED_ROOTS.some((root) => isInside(realpathSync(root), realResolved)),
    `${file} imports production or out-of-packet target ${specifier}`,
  );
}

const AMBIENT_CAPABILITIES = Object.freeze([
  ['DATE_AMBIENT_CLOCK', /\bDate\b/],
  ['PERFORMANCE_NOW', /\bperformance\s*(?:\.|\?\.)\s*now\s*\(/],
  ['PROCESS_HRTIME', /\bprocess\s*(?:\.|\?\.)\s*hrtime(?:\s*(?:\.|\?\.)\s*bigint)?\s*\(/],
  ['MATH_RANDOM', /\bMath\s*(?:\.|\?\.)\s*random\s*\(/],
  ['PROCESS_ENV', /\bprocess\s*(?:(?:\.|\?\.)\s*env|\[\s*['"]env['"]\s*\])/],
  ['PROCESS_BUILTIN_ESCAPE', /\bprocess\s*(?:\.|\?\.)\s*(?:getBuiltinModule|binding)\s*\(/],
  ['NETWORK_GLOBAL', /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\b/],
  ['TIMER_OR_MICROTASK', /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask)\b/],
  ['COMMONJS_REQUIRE', /\brequire\s*(?:\?\.)?\s*\(/],
  ['COMMONJS_LOADER', /\b(?:createRequire|module\s*\.\s*require)\b/],
  ['DYNAMIC_CODE', /\b(?:eval|Function)\s*\(/],
]);

test('both assigned roots fail closed on imports and ambient capabilities', () => {
  const files = ASSIGNED_ROOTS.flatMap(moduleFiles).sort();
  assert.ok(files.some((file) => isInside(FIXTURE_ROOT, file)), 'fixture modules missing');
  assert.ok(files.some((file) => isInside(TEST_ROOT, file)), 'test modules missing');

  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    assertLiteralModuleCalls(source, file);
    for (const specifier of literalModuleSpecifiers(source)) assertAllowedSpecifier(file, specifier);

    // This harness intentionally traps the ambient APIs below. Every packet module
    // and every other test remains subject to the static prohibition.
    if (file === IMPORT_PURITY_TEST) continue;
    for (const [code, pattern] of AMBIENT_CAPABILITIES) {
      assert.doesNotMatch(source, pattern, `${file} uses forbidden ambient capability ${code}`);
    }
  }
});

function replaceGlobal(name, value, descriptors) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
}

function restoreGlobals(descriptors) {
  for (const [name, descriptor] of descriptors) {
    if (descriptor === undefined) delete globalThis[name];
    else Object.defineProperty(globalThis, name, descriptor);
  }
}

test('packet-local modules import and evaluate without ambient work', async () => {
  const descriptors = new Map();
  const calls = {
    date: 0,
    dateNow: 0,
    random: 0,
    fetch: 0,
    webSocket: 0,
    eventSource: 0,
    timeout: 0,
    interval: 0,
    immediate: 0,
    microtask: 0,
  };
  const OriginalDate = globalThis.Date;
  const DateTrap = new Proxy(OriginalDate, {
    apply(target, thisArg, args) {
      calls.date += 1;
      return Reflect.apply(target, thisArg, args);
    },
    construct(target, args, newTarget) {
      calls.date += 1;
      return Reflect.construct(target, args, newTarget);
    },
    get(target, property, receiver) {
      if (property === 'now') return () => { calls.dateNow += 1; return 0; };
      return Reflect.get(target, property, receiver);
    },
  });

  replaceGlobal('Date', DateTrap, descriptors);
  replaceGlobal('fetch', () => { calls.fetch += 1; throw new Error('network forbidden'); }, descriptors);
  replaceGlobal('WebSocket', class { constructor() { calls.webSocket += 1; } }, descriptors);
  replaceGlobal('EventSource', class { constructor() { calls.eventSource += 1; } }, descriptors);
  replaceGlobal('setTimeout', () => { calls.timeout += 1; throw new Error('timer forbidden'); }, descriptors);
  replaceGlobal('setInterval', () => { calls.interval += 1; throw new Error('timer forbidden'); }, descriptors);
  replaceGlobal('setImmediate', () => { calls.immediate += 1; throw new Error('timer forbidden'); }, descriptors);
  replaceGlobal('queueMicrotask', () => { calls.microtask += 1; throw new Error('microtask forbidden'); }, descriptors);
  const originalRandom = Math.random;
  Math.random = () => { calls.random += 1; return 0; };

  try {
    const contracts = await import('../../../../fixtures/productAssurance/systemic/stability/contracts.mjs?purity-s8');
    const fixtures = await import('../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs?purity-s8');
    const evaluators = await import('../../../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs?purity-s8');
    const viewModel = await import('../../../../fixtures/productAssurance/systemic/stability/view-model.mjs?purity-s8');
    await import('../../../../fixtures/productAssurance/systemic/stability/drafts/rows.mjs?purity-s8');
    const cancellation = evaluators.evaluateCancellationEvidence(fixtures.makeCancellationEvidence(), fixtures.FIXTURE_NOW_MS);
    const repair = evaluators.evaluateRepairLoop(fixtures.makeRepairPolicy(), fixtures.makeRepairEvidence(), fixtures.FIXTURE_NOW_MS);
    const resources = evaluators.evaluateResourceEvidence(fixtures.makeResourceEvidenceBundle(), fixtures.FIXTURE_NOW_MS);
    viewModel.projectStabilityViewModel({ cancellationAssessments: [cancellation], repairAssessments: [repair], resourceAssessment: resources }, fixtures.FIXTURE_NOW_MS);
    assert.equal(contracts.STABILITY_SCHEMA_VERSION, 'ip-assurance.systemic.stability.v1');
    assert.deepEqual(calls, {
      date: 0,
      dateNow: 0,
      random: 0,
      fetch: 0,
      webSocket: 0,
      eventSource: 0,
      timeout: 0,
      interval: 0,
      immediate: 0,
      microtask: 0,
    });
  } finally {
    Math.random = originalRandom;
    restoreGlobals(descriptors);
  }
});

test('reference modules expose no control, throttle, lease, persistence, or execution authority', async () => {
  const modules = [
    await import('../../../../fixtures/productAssurance/systemic/stability/contracts.mjs'),
    await import('../../../../fixtures/productAssurance/systemic/stability/fixtures.mjs'),
    await import('../../../../fixtures/productAssurance/systemic/stability/reference-evaluator.mjs'),
    await import('../../../../fixtures/productAssurance/systemic/stability/view-model.mjs'),
    await import('../../../../fixtures/productAssurance/systemic/stability/drafts/rows.mjs'),
  ];
  const forbiddenExport = /^(?:execute|dispatch|submit|placeOrder|cancel|throttle|shed|acquire|renew|reserve|persist|write|publish|start|stop|restart|borrow|repay|transfer|withdraw)/i;
  for (const module of modules) {
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === 'function') assert.doesNotMatch(name, forbiddenExport, `authority-like callable export ${name}`);
    }
  }
});
