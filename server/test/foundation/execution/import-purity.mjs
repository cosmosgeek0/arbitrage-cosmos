#!/usr/bin/env node
/** Import-time purity and compiled-I/O proof for Lane C. */
import { installFoundationFetchDenial } from '../import-purity-network-denial.mjs';

// Preload the coordinator's declared Node built-in before project-code tripwires
// so Node's own color-policy environment probe is not attributed to the module.
await import('node:util');

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

section('1b. direct-only Spot transport coordinator imports inertly');
const coordinatorEnvReadStart = envReads.length;
const coordinatorMod = await import(
  '../../../dist/foundation/execution/spotTransportCoordinator.js'
);
const coordinatorEnvReads = envReads
  .slice(coordinatorEnvReadStart)
  .filter((key) => !toleratedLoaderEnv.has(key));
check('coordinator import has no Date.now', dateNowCalls === 0, `${dateNowCalls} calls`);
check('coordinator import has no fetch', fetchDenial.attempts() === 0, `${fetchDenial.attempts()} calls`);
check('coordinator import has no setTimeout', timeoutCalls === 0, `${timeoutCalls} calls`);
check('coordinator import has no setInterval', intervalCalls === 0, `${intervalCalls} calls`);
check('coordinator import has no Math.random', randomCalls === 0, `${randomCalls} calls`);
check('coordinator import has no process.env reads', coordinatorEnvReads.length === 0, coordinatorEnvReads.join(','));
const coordinatorGlobals = Object.getOwnPropertyNames(globalThis).filter((key) => !globalsBefore.has(key));
check('coordinator import creates no globals', coordinatorGlobals.length === 0, coordinatorGlobals.join(','));

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
  'createSpotValidateOnlySeam',
]) {
  check(`exports ${name}()`, typeof mod[name] === 'function');
}
check(
  'execution barrel does not export Spot transport coordinator',
  mod.runSpotTransportCoordinator === undefined
    && mod.SPOT_TRANSPORT_COORDINATOR_SCHEMA === undefined
    && mod.SPOT_TRANSPORT_COORDINATOR_POSTURE === undefined,
);
check(
  'Spot transport coordinator remains direct-import-only',
  typeof coordinatorMod.runSpotTransportCoordinator === 'function',
);

section('3. compiled Lane C modules contain no implicit I/O');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation/execution');
  const files = readdirSync(distDir).filter((file) => file.endsWith('.js')).sort();
  const expectedFiles = [
    'checkpoint.js',
    'coordinator.js',
    'events.js',
    'index.js',
    'plan.js',
    'recovery.js',
    'reducer.js',
    'spotAttemptPolicy.js',
    'spotCore.js',
    'spotLifecycle.js',
    'spotPort.js',
    'spotTicket.js',
    'spotTransportCoordinator.js',
    'spotValidateOnly.js',
    'types.js',
  ];
  check(
    'exact compiled execution module set present',
    JSON.stringify(files) === JSON.stringify(expectedFiles),
    files.join(','),
  );
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
  const existingCode = files
    .filter((file) => (
      file !== 'spotValidateOnly.js'
      && file !== 'spotTransportCoordinator.js'
    ))
    .map((file) => codeOnly(readFileSync(join(distDir, file), 'utf8')))
    .join('\n');
  check('no concrete live-order method', !/placeOrder|submitLive|liveOrder|newOrder\s*\(/i.test(existingCode));
  check('no capital-movement method', !/withdraw|repay|transferOut|changeLeverage|changeMarginMode/i.test(existingCode));

  const validateOnlyCode = codeOnly(
    readFileSync(join(distDir, 'spotValidateOnly.js'), 'utf8'),
  );
  check(
    'validate-only seam has no external-action call',
    !/(placeOrder|submitLive\w*|liveOrder|newOrder|withdraw\w*|repay|borrow|transfer\w*|changeLeverage|changeMarginMode)\s*\(/i.test(validateOnlyCode),
  );
  for (const capability of [
    'signedTestOrder',
    'liveOrder',
    'orderQuery',
    'cancelOrder',
    'withdrawal',
    'transfer',
    'borrow',
    'repay',
  ]) {
    check(
      `validate-only seam denies ${capability}`,
      new RegExp(`${capability}:\\s*false`).test(validateOnlyCode),
    );
  }

  const indexCode = codeOnly(readFileSync(join(distDir, 'index.js'), 'utf8'));
  const coordinatorCode = codeOnly(
    readFileSync(join(distDir, 'spotTransportCoordinator.js'), 'utf8'),
  );
  check(
    'compiled execution barrel omits Spot transport coordinator',
    !/spotTransportCoordinator/.test(indexCode),
  );
  for (const [label, pattern] of [
    ['ambient environment', /process\.env|\b(?:Bun|Deno)\.env\b/],
    ['ambient clock', /Date\.now|new Date\s*\(|performance\.now/],
    ['ambient randomness', /Math\.random/],
    ['network capability', /\bfetch\s*\(|node:(?:dgram|dns|http2?|https|net|tls)|from ['"](?:axios|undici|ws)['"]/],
    ['filesystem capability', /node:fs|from ['"]fs(?:\/promises)?['"]/],
    ['signer or credential capability', /credential|signer|apiKey|apiSecret|secretKey/i],
  ]) {
    check(
      `Spot transport coordinator has no ${label}`,
      !pattern.test(coordinatorCode),
    );
  }
  check(
    'Spot transport coordinator imports no concrete execution adapter',
    !/liveEdge|binanceSpotExecution|createBinanceSpotExecutionAdapter/.test(coordinatorCode),
  );
  const injectedPortMethods = [...coordinatorCode.matchAll(
    /ports\.executionPort\.([A-Za-z][A-Za-z0-9]*)\s*\(/g,
  )].map((match) => match[1]).sort();
  check(
    'Spot venue capabilities use only the injected execution port',
    JSON.stringify([...new Set(injectedPortMethods)]) === JSON.stringify([
      'cancel',
      'flatten',
      'queryByOriginalClientOrderId',
      'queryFills',
      'signedTestOrder',
      'submitLiveOrder',
    ]),
    [...new Set(injectedPortMethods)].join(','),
  );
  check(
    'Spot transport coordinator posture remains direct-only',
    JSON.stringify(coordinatorMod.SPOT_TRANSPORT_COORDINATOR_POSTURE) === JSON.stringify({
      liveMounted: false,
      liveExportReachable: false,
      sharedBarrelExported: false,
      automaticMutationRetry: false,
    }),
  );
  check(
    'Spot transport coordinator never enables automatic mutation retry',
    !/automatic(?:Mutation)?Retry:\s*true/.test(coordinatorCode)
      && coordinatorMod.SPOT_TRANSPORT_COORDINATOR_POSTURE.automaticMutationRetry === false,
  );
}

const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} execution import-purity checks passed`);
if (passed !== results.length) process.exit(1);
