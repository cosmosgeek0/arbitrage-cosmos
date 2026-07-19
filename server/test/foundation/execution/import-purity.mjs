#!/usr/bin/env node
/** Import-time purity and compiled-I/O proof for Lane C. */
import { installFoundationFetchDenial } from '../import-purity-network-denial.mjs';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
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

Date.now = () => { dateNowCalls += 1; return realDateNow(); };
const fetchDenial = installFoundationFetchDenial();
globalThis.setTimeout = (...args) => { timeoutCalls += 1; return realTimeout(...args); };
globalThis.setInterval = (...args) => { intervalCalls += 1; return realInterval(...args); };
Math.random = () => { randomCalls += 1; return realRandom(); };
process.env = new Proxy(realEnv, {
  get(target, prop, receiver) {
    if (typeof prop === 'string') envReads.push(prop);
    return Reflect.get(target, prop, receiver);
  },
});
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

section('1. execution barrel import is side-effect-free');
const mod = await import('../../../dist/foundation/execution/index.js');
check('no Date.now during import', dateNowCalls === 0, `${dateNowCalls} calls`);
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('no fetch during import', fetchDenial.attempts() === 0, `${fetchDenial.attempts()} calls`);
check('no setTimeout during import', timeoutCalls === 0, `${timeoutCalls} calls`);
check('no setInterval during import', intervalCalls === 0, `${intervalCalls} calls`);
check('no Math.random during import', randomCalls === 0, `${randomCalls} calls`);
const moduleEnvReads = envReads.filter((key) => !toleratedLoaderEnv.has(key));
check('no process.env reads during import', moduleEnvReads.length === 0, moduleEnvReads.join(','));
const newGlobals = Object.getOwnPropertyNames(globalThis).filter((key) => !globalsBefore.has(key));
check('no globals created during import', newGlobals.length === 0, newGlobals.join(','));

Date.now = realDateNow;
fetchDenial.restore();
globalThis.setTimeout = realTimeout;
globalThis.setInterval = realInterval;
Math.random = realRandom;
process.env = realEnv;

section('2. Lane C exports real behavior');
for (const name of [
  'createExecutionPlanDefinition',
  'createExecutionEvent',
  'reduceExecutionEvent',
  'replayExecutionEvents',
  'createExecutionCheckpoint',
  'serializeExecutionCheckpoint',
  'restoreExecutionCheckpoint',
  'recommendExecutionRecovery',
  'createExecutionCoordinator',
  'restoreExecutionCoordinator',
]) {
  check(`exports ${name}()`, typeof mod[name] === 'function');
}

section('3. compiled Lane C modules contain no implicit I/O');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation/execution');
  const files = readdirSync(distDir).filter((file) => file.endsWith('.js'));
  check('all eight compiled execution modules present', files.length === 8, files.join(','));
  const forbidden = [
    ['process.env', /process\.env/],
    ['Date.now', /Date\.now/],
    ['new Date', /new Date\s*\(/],
    ['Math.random', /Math\.random/],
    ['fetch', /\bfetch\s*\(/],
    ['setTimeout', /setTimeout/],
    ['setInterval', /setInterval/],
    ['filesystem import', /node:fs|from ['"]fs['"]/],
    ['HTTP or socket import', /node:https?|node:net|from ['"]ws['"]/],
    ['environment timer import', /node:timers/],
  ];
  const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [label, pattern] of forbidden) {
    const offenders = files.filter((file) => pattern.test(codeOnly(readFileSync(join(distDir, file), 'utf8'))));
    check(`no ${label}`, offenders.length === 0, offenders.join(','));
  }
  const allCode = files.map((file) => codeOnly(readFileSync(join(distDir, file), 'utf8'))).join('\n');
  check('no concrete live-order method', !/placeOrder|submitLive|liveOrder|newOrder\s*\(/i.test(allCode));
  check('no capital-movement method', !/withdraw|repay|transferOut|changeLeverage|changeMarginMode/i.test(allCode));
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} execution import-purity checks passed`);
if (passed !== results.length) process.exit(1);
