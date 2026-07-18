#!/usr/bin/env node
/**
 * Lane H — import/use purity proof. Instruments side-effectful globals before
 * importing the compiled observability barrel and statically scans this lane.
 */
import { installFoundationFetchDenial } from '../import-purity-network-denial.mjs';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

let dateNowCalls = 0;
let setTimeoutCalls = 0;
let setIntervalCalls = 0;
let randomCalls = 0;
const envReadKeys = [];
const NODE_LOADER_ENV_KEYS = new Set(['WATCH_REPORT_DEPENDENCIES']);

const realDateNow = Date.now;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realRandom = Math.random;
const realEnv = process.env;

Date.now = function countedNow() { dateNowCalls += 1; return realDateNow(); };
const fetchDenial = installFoundationFetchDenial();
globalThis.setTimeout = function countedSetTimeout(...args) { setTimeoutCalls += 1; return realSetTimeout.apply(this, args); };
globalThis.setInterval = function countedSetInterval(...args) { setIntervalCalls += 1; return realSetInterval.apply(this, args); };
Math.random = function countedRandom() { randomCalls += 1; return realRandom(); };
process.env = new Proxy(realEnv, {
  get(target, prop, receiver) {
    if (typeof prop === 'string') envReadKeys.push(prop);
    return Reflect.get(target, prop, receiver);
  },
});
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

section('1. importing the observability barrel has no side effects');
const mod = await import('../../../dist/foundation/observability/index.js');
check('no Date.now during import', dateNowCalls === 0, `${dateNowCalls} calls`);
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('no fetch during import', fetchDenial.attempts() === 0, `${fetchDenial.attempts()} calls`);
check('no setTimeout during import', setTimeoutCalls === 0, `${setTimeoutCalls} calls`);
check('no setInterval during import', setIntervalCalls === 0, `${setIntervalCalls} calls`);
check('no Math.random during import', randomCalls === 0, `${randomCalls} calls`);
const moduleEnvReads = envReadKeys.filter((key) => !NODE_LOADER_ENV_KEYS.has(key));
check('no process.env reads during import', moduleEnvReads.length === 0, moduleEnvReads.join(','));
const newGlobals = Object.getOwnPropertyNames(globalThis).filter((key) => !globalsBefore.has(key));
check('no globals created', newGlobals.length === 0, newGlobals.join(','));

Date.now = realDateNow;
fetchDenial.restore();
globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
Math.random = realRandom;
process.env = realEnv;

section('2. barrel is behavior-bearing, not an empty shell');
check('exports deriveDiagnostics()', typeof mod.deriveDiagnostics === 'function');
check('exports explicit baseline vocabulary', Array.isArray(mod.BASELINE_STATES) && mod.BASELINE_STATES.includes('UNKNOWN'));
check('exports explicit borrow vocabulary', Array.isArray(mod.BORROW_COVERAGE_STATES) && mod.BORROW_COVERAGE_STATES.includes('UNKNOWN'));
check('exports explicit rate vocabulary', Array.isArray(mod.RATE_STATES) && mod.RATE_STATES.includes('COUNTER_RESET') && mod.RATE_STATES.includes('STALE'));
check('exports typed failure code', mod.OBSERVABILITY_FAILURE_CODES.EVIDENCE_INVALID === 'DIAGNOSTIC_EVIDENCE_INVALID');

section('3. compiled lane is statically free of I/O and ambient-time primitives');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation/observability');
  const files = readdirSync(distDir).filter((file) => file.endsWith('.js'));
  check('all three observability modules compiled', files.length === 3, files.join(','));
  const forbidden = [
    ['process.env', /process\.env/],
    ['Date.now', /Date\.now/],
    ['new Date(', /new Date\(/],
    ['Math.random', /Math\.random/],
    ['fetch(', /\bfetch\s*\(/],
    ['setTimeout', /setTimeout/],
    ['setInterval', /setInterval/],
    ['node:fs', /node:fs|require\(['"]fs['"]\)/],
    ['node:http(s)', /node:https?|require\(['"]https?['"]\)/],
    ['node:net/ws', /node:net|require\(['"]ws['"]\)|from ['"]ws['"]/],
    ['process mutation', /process\.(exit|kill|abort)\s*\(/],
    ['locale-dependent comparison', /localeCompare/],
  ];
  const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [label, pattern] of forbidden) {
    const offenders = files.filter((file) => pattern.test(codeOnly(readFileSync(join(distDir, file), 'utf8'))));
    check(`no ${label} in compiled lane`, offenders.length === 0, offenders.join(','));
  }
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const item of failed) console.log(`  ✗ ${item.name}`);
  process.exit(1);
}
