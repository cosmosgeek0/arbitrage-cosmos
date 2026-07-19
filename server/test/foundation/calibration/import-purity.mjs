#!/usr/bin/env node
/** Import/use purity and static no-I/O proof for Wave 3 calibration. */
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
const NODE_LOADER_ENV_KEYS = new Set(['WATCH_REPORT_DEPENDENCIES']);
const realDateNow = Date.now;
const realTimeout = globalThis.setTimeout;
const realInterval = globalThis.setInterval;
const realRandom = Math.random;
const realEnv = process.env;

Date.now = function countedNow() { dateNowCalls += 1; return realDateNow(); };
const fetchDenial = installFoundationFetchDenial();
globalThis.setTimeout = function countedTimeout(...args) { timeoutCalls += 1; return realTimeout.apply(this, args); };
globalThis.setInterval = function countedInterval(...args) { intervalCalls += 1; return realInterval.apply(this, args); };
Math.random = function countedRandom() { randomCalls += 1; return realRandom(); };
process.env = new Proxy(realEnv, {
  get(target, property, receiver) {
    if (typeof property === 'string') envReads.push(property);
    return Reflect.get(target, property, receiver);
  },
});
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

section('1. importing calibration has no ambient effects');
const mod = await import('../../../dist/foundation/calibration/index.js');
check('no Date.now during import', dateNowCalls === 0, `${dateNowCalls} calls`);
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('no fetch during import', fetchDenial.attempts() === 0, `${fetchDenial.attempts()} calls`);
check('no setTimeout during import', timeoutCalls === 0, `${timeoutCalls} calls`);
check('no setInterval during import', intervalCalls === 0, `${intervalCalls} calls`);
check('no Math.random during import', randomCalls === 0, `${randomCalls} calls`);
const moduleEnvReads = envReads.filter((key) => !NODE_LOADER_ENV_KEYS.has(key));
check('no process.env reads during import', moduleEnvReads.length === 0, moduleEnvReads.join(','));
const newGlobals = Object.getOwnPropertyNames(globalThis).filter((key) => !globalsBefore.has(key));
check('no globals created', newGlobals.length === 0, newGlobals.join(','));

Date.now = realDateNow;
fetchDenial.restore();
globalThis.setTimeout = realTimeout;
globalThis.setInterval = realInterval;
Math.random = realRandom;
process.env = realEnv;

section('2. public seam is behavior-bearing and observational only');
check('exports recordProposalOutcome()', typeof mod.recordProposalOutcome === 'function');
check('exports aggregateProposalOutcomes()', typeof mod.aggregateProposalOutcomes === 'function');
check('exports exact unit vocabulary', Array.isArray(mod.OUTCOME_RESULT_UNITS) && mod.OUTCOME_RESULT_UNITS.includes('USD_MICROS'));
check('exports explicit incomplete state', Array.isArray(mod.OUTCOME_STATUSES) && mod.OUTCOME_STATUSES.includes('INCOMPLETE'));
const dangerous = Object.keys(mod).filter((name) => /threshold|tune|recommend|apply|execute|mutat/i.test(name));
check('exports no tuning or mutation method', dangerous.length === 0, dangerous.join(','));

section('3. compiled calibration lane contains no I/O, clock, locale, or mutable singleton');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation/calibration');
  const files = readdirSync(distDir).filter((file) => file.endsWith('.js'));
  check('all four calibration modules compiled', files.length === 4, files.join(','));
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
    ['locale-dependent compare', /localeCompare/],
  ];
  const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [label, pattern] of forbidden) {
    const offenders = files.filter((file) => pattern.test(codeOnly(readFileSync(join(distDir, file), 'utf8'))));
    check(`no ${label} in compiled lane`, offenders.length === 0, offenders.join(','));
  }
}

const failed = results.filter((item) => !item.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const item of failed) console.log(`  ✗ ${item.name}`);
  process.exit(1);
}
