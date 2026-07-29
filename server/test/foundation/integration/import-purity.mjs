#!/usr/bin/env node
/** Cross-lane import-purity proof for every foundation public barrel. */
import { installFoundationFetchDenial } from '../import-purity-network-denial.mjs';

const results = [];
function check(name, pass, detail = '') {
  const ok = pass === true;
  results.push({ name, pass: ok });
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

let dateNowCalls = 0;
let timeoutCalls = 0;
let intervalCalls = 0;
let randomCalls = 0;
const envReads = [];
const toleratedLoaderEnv = new Set(['WATCH_REPORT_DEPENDENCIES']);

const realDateNow = Date.now;
const realTimeout = globalThis.setTimeout;
const realInterval = globalThis.setInterval;
const realRandom = Math.random;
const realEnv = process.env;

Date.now = (...args) => { dateNowCalls += 1; return realDateNow(...args); };
const fetchDenial = installFoundationFetchDenial();
globalThis.setTimeout = (...args) => { timeoutCalls += 1; return realTimeout(...args); };
globalThis.setInterval = (...args) => { intervalCalls += 1; return realInterval(...args); };
Math.random = (...args) => { randomCalls += 1; return realRandom(...args); };
process.env = new Proxy(realEnv, {
  get(target, property, receiver) {
    if (typeof property === 'string') envReads.push(property);
    return Reflect.get(target, property, receiver);
  },
});
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

const barrels = [
  ['contracts', '../../../dist/foundation/contracts/index.js', 'createStructuredFailure'],
  ['control', '../../../dist/foundation/control/index.js', 'createDeterministicSupervisor'],
  ['readModel', '../../../dist/foundation/readModel/index.js', 'buildCanonicalReadModel'],
  ['execution', '../../../dist/foundation/execution/index.js', 'createExecutionCoordinator'],
  ['risk', '../../../dist/foundation/risk/index.js', 'evaluateMultiLegRisk'],
  ['reconciliation', '../../../dist/foundation/reconciliation/index.js', 'reconcileExecutionState'],
  ['binanceUsdM', '../../../dist/foundation/exchange/binanceUsdM/index.js', 'BinanceUsdMClient'],
  ['replay', '../../../dist/foundation/replay/index.js', 'createPrePostReplayCapture'],
  ['observability', '../../../dist/foundation/observability/index.js', 'deriveDiagnostics'],
  ['scenarios', '../../../dist/foundation/scenarios/index.js', 'generateScenario'],
  ['borrow', '../../../dist/foundation/borrow/index.js', 'deriveBorrowTruth'],
  ['calibration', '../../../dist/foundation/calibration/index.js', 'recordProposalOutcome'],
];

section('1. all public barrels import without ambient effects');
const imported = [];
for (const [name, path, expectedExport] of barrels) {
  const module = await import(path);
  imported.push({ name, module, expectedExport });
}
check('no Date.now during imports', dateNowCalls === 0, `${dateNowCalls} calls`);
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('no fetch during imports', fetchDenial.attempts() === 0, `${fetchDenial.attempts()} calls`);
check('no setTimeout during imports', timeoutCalls === 0, `${timeoutCalls} calls`);
check('no setInterval during imports', intervalCalls === 0, `${intervalCalls} calls`);
check('no Math.random during imports', randomCalls === 0, `${randomCalls} calls`);
const moduleEnvReads = envReads.filter((key) => !toleratedLoaderEnv.has(key));
check('no process.env reads during imports', moduleEnvReads.length === 0, moduleEnvReads.join(','));
const createdGlobals = Object.getOwnPropertyNames(globalThis).filter((key) => !globalsBefore.has(key));
check('no globals created during imports', createdGlobals.length === 0, createdGlobals.join(','));

Date.now = realDateNow;
fetchDenial.restore();
globalThis.setTimeout = realTimeout;
globalThis.setInterval = realInterval;
Math.random = realRandom;
process.env = realEnv;

section('2. every barrel exposes its intended behavior seam');
for (const { name, module, expectedExport } of imported) {
  check(`${name} exports ${expectedExport}`, typeof module[expectedExport] === 'function');
}

section('3. all compiled foundation modules are free of implicit I/O primitives');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.js')) files.push(path);
    }
  };
  visit(root);
  check('all 85 compiled foundation modules are present', files.length === 85, `${files.length} modules`);
  const modulePaths = files.map((file) => file.slice(root.length + 1)).sort();
  check(
    'compiled foundation includes execution/spotTransportCoordinator.js',
    modulePaths.includes('execution/spotTransportCoordinator.js'),
  );
  const codeOnly = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const forbidden = [
    ['process.env', /process\.env/],
    ['Date.now', /Date\.now/],
    ['new Date', /new Date\s*\(/],
    ['Math.random', /Math\.random/],
    ['fetch', /\bfetch\s*\(/],
    ['setTimeout', /setTimeout/],
    ['setInterval', /setInterval/],
    ['filesystem import', /node:fs|from ['"]fs['"]/],
    ['network or timer import', /node:https?|node:net|node:timers|from ['"]ws['"]/],
  ];
  for (const [label, pattern] of forbidden) {
    const offenders = files.filter((file) => pattern.test(codeOnly(readFileSync(file, 'utf8'))));
    check(`compiled foundation has no ${label}`, offenders.length === 0, offenders.map((file) => file.slice(root.length + 1)).join(','));
  }
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} cross-lane import-purity checks passed`);
if (passed !== results.length) process.exit(1);
