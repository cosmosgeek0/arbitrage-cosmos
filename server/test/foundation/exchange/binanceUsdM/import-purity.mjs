#!/usr/bin/env node
/** Lane F import-time purity, compiled-I/O, and authority-surface proof. */
import { installFoundationFetchDenial } from '../../import-purity-network-denial.mjs';

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
  get(target, property, receiver) {
    if (typeof property === 'string') envReads.push(property);
    return Reflect.get(target, property, receiver);
  },
});
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

section('1. barrel import is side-effect-free');
const mod = await import('../../../../dist/foundation/exchange/binanceUsdM/index.js');
check('no Date.now during import', dateNowCalls === 0, `${dateNowCalls}`);
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('no global fetch during import', fetchDenial.attempts() === 0, `${fetchDenial.attempts()}`);
check('no setTimeout during import', timeoutCalls === 0, `${timeoutCalls}`);
check('no setInterval during import', intervalCalls === 0, `${intervalCalls}`);
check('no Math.random during import', randomCalls === 0, `${randomCalls}`);
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

section('2. barrel exposes behavior but no concrete transport or live action');
for (const name of [
  'BinanceUsdMClient',
  'createHmacSha256Signer',
  'encodeForm',
  'normalizeDecimalString',
  'compareDecimalStrings',
  'isDecimalMultiple',
  'isDecimalOffsetMultiple',
  'multiplyDecimalStrings',
  'validateTestOrder',
  'serializeSafeRequest',
  'serializeSafeError',
]) {
  check(`exports ${name}`, typeof mod[name] === 'function');
}
for (const name of [
  'BinanceUsdMHttpTransport',
  'placeOrder',
  'cancelOrder',
  'replaceOrder',
  'borrow',
  'repay',
  'transfer',
  'withdraw',
]) {
  check(`does not export ${name}`, mod[name] === undefined);
}
check('endpoint matrix exported as frozen data', Object.isFrozen(mod.BINANCE_USDM_ENDPOINTS));
check('endpoint entries are frozen', Object.values(mod.BINANCE_USDM_ENDPOINTS).every(Object.isFrozen));
check('sole non-idempotent endpoint is TEST_ORDER', Object.entries(mod.BINANCE_USDM_ENDPOINTS).filter(([, value]) => !value.idempotent).map(([key]) => key).join(',') === 'TEST_ORDER');
check('sole POST path is /order/test', Object.values(mod.BINANCE_USDM_ENDPOINTS).filter((value) => value.method === 'POST').every((value) => value.path === '/fapi/v1/order/test'));

section('3. compiled modules contain no implicit I/O or authority expansion');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distRoots = [
    ['binanceUsdM', join(dirname(fileURLToPath(import.meta.url)), '../../../../dist/foundation/exchange/binanceUsdM')],
    ['binanceUsdMAdapter', join(dirname(fileURLToPath(import.meta.url)), '../../../../dist/foundation/exchange/binanceUsdMAdapter')],
  ];
  const compiledModules = distRoots.flatMap(([root, distDir]) => (
    readdirSync(distDir)
      .filter((file) => file.endsWith('.js'))
      .sort()
      .map((file) => ({
        root,
        file,
        source: readFileSync(join(distDir, file), 'utf8'),
      }))
  ));
  const source = compiledModules.map((module) => module.source).join('\n');
  const files = compiledModules.map((module) => `${module.root}/${module.file}`);
  check(
    'compiled module set covers public groundwork and validate-only adapter',
    distRoots.every(([root]) => compiledModules.some((module) => module.root === root)),
    files.join(','),
  );
  const forbidden = [
    ['environment access', /process\.env/],
    ['wall clock', /Date\.now\s*\(/],
    ['hidden timeout', /setTimeout\s*\(/],
    ['hidden interval', /setInterval\s*\(/],
    ['global network call', /\bfetch\s*\(/],
    ['websocket', /\bWebSocket\b/],
    ['network module', /node:(?:http|https|net|tls|dns|dgram|undici)/],
    ['filesystem module', /node:(?:fs|fs\/promises)/],
    ['child process', /node:child_process/],
    ['random identity', /Math\.random\s*\(/],
    ['runtime startup hook', /process\.(?:on|once)\s*\(/],
    ['concrete production host', /fapi\.binance\.com/],
    ['live leverage mutation path', /\/fapi\/v1\/leverage/],
    ['margin-mode mutation path', /\/fapi\/v1\/marginType/],
    ['capital movement path', /\/(?:borrow|repay|transfer|withdraw)/],
  ];
  for (const [name, pattern] of forbidden) check(`no ${name}`, !pattern.test(source));
  const publicGroundworkSource = compiledModules
    .filter((module) => module.root === 'binanceUsdM')
    .map((module) => module.source)
    .join('\n');
  const postDeclarations = publicGroundworkSource.match(/method:\s*'POST'/g) ?? [];
  check('exactly one compiled POST declaration', postDeclarations.length === 1, `${postDeclarations.length}`);
  check('compiled POST declaration is test-only', /TEST_ORDER:[^\n]+method:\s*'POST'[^\n]+\/fapi\/v1\/order\/test/.test(publicGroundworkSource));
  for (const endpoint of Object.values(mod.BINANCE_USDM_ENDPOINTS)) {
    check(`compiled endpoint present ${endpoint.path}`, publicGroundworkSource.includes(endpoint.path));
  }
}

const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} binance-usdm-import-purity: ${passed}/${results.length}`);
if (failed > 0) process.exit(1);
