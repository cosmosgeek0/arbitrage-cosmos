#!/usr/bin/env node
/** Import-time purity and compiled-authority proof for Wave 3 scenarios. */
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

section('1. scenarios barrel import is side-effect-free');
const mod = await import('../../../dist/foundation/scenarios/index.js');
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

section('2. Wave 3 exports real deterministic behavior');
for (const name of [
  'xorshift32Step',
  'createScenarioPrng',
  'generateScenario',
  'generateScenarioCatalog',
  'serializeScenario',
  'scenarioToReplayInputs',
  'compareScenarioFacts',
]) {
  check(`exports ${name}()`, typeof mod[name] === 'function');
}
check('exports exactly fourteen scenario kinds', mod.SCENARIO_KINDS.length === 14);
check('exports explicit XORSHIFT32_V1 algorithm', mod.SCENARIO_PRNG_ALGORITHM === 'XORSHIFT32_V1');
check('exports NONE execution authority', mod.SCENARIO_EXECUTION_AUTHORITY === 'NONE');

section('3. compiled scenarios contain no implicit I/O or live authority');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation/scenarios');
  const files = readdirSync(distDir).filter((file) => file.endsWith('.js'));
  check('all four compiled scenario modules present', files.length === 4, files.join(','));
  const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
    ['locale-sensitive ordering', /localeCompare/],
  ];
  for (const [label, pattern] of forbidden) {
    const offenders = files.filter((file) => pattern.test(codeOnly(readFileSync(join(distDir, file), 'utf8'))));
    check(`no ${label}`, offenders.length === 0, offenders.join(','));
  }
  const allCode = files.map((file) => codeOnly(readFileSync(join(distDir, file), 'utf8'))).join('\n');
  check('no concrete order/cancel method', !/placeOrder|submitOrder|cancelOrder|submitLive|newOrder\s*\(/i.test(allCode));
  check('no capital-movement method', !/withdraw|repay|transferOut|changeLeverage|changeMarginMode/i.test(allCode));
  check('scenario authority is synthetic only', !/authority:\s*['"]LIVE_/i.test(allCode));
  check('no strategy-decision constructor', !/createDecision|createSignal|deriveVerdict|scoreOpportunity/i.test(allCode));
}

const passed = results.filter((item) => item.pass).length;
console.log(`\n${passed}/${results.length} scenario import-purity checks passed`);
if (passed !== results.length) process.exit(1);
