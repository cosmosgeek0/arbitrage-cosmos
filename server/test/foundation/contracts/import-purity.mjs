#!/usr/bin/env node
/**
 * Foundation contract kernel — import-purity proof. Verifies that importing
 * the contracts barrel performs NO side effects: no wall-clock reads, no
 * fetch, no timers, no randomness, no env reads, no new globals.
 *
 * Instruments the runtime BEFORE the dynamic import, imports the barrel,
 * then asserts every counter is still zero. ZERO network by construction —
 * a patched fetch would count (and fail) if anything tried.
 *
 * Run after `npm run build -w server`:
 *   node server/test/foundation/contracts/import-purity.mjs
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

// ---------- instrument BEFORE import ----------

let dateNowCalls = 0;
let setTimeoutCalls = 0;
let setIntervalCalls = 0;
let randomCalls = 0;
const envReadKeys = [];

/**
 * Node's own ESM loader reads this env key once per module it loads
 * (--watch support). It is runtime overhead, not module behavior, so it is
 * the ONLY tolerated key; anything else read during import fails the test.
 */
const NODE_LOADER_ENV_KEYS = new Set(['WATCH_REPORT_DEPENDENCIES']);

const realDateNow = Date.now;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realRandom = Math.random;
const realEnv = process.env;

Date.now = function countedNow() {
  dateNowCalls++;
  return realDateNow();
};
const fetchDenial = installFoundationFetchDenial();
globalThis.setTimeout = function countedSetTimeout(...args) {
  setTimeoutCalls++;
  return realSetTimeout.apply(this, args);
};
globalThis.setInterval = function countedSetInterval(...args) {
  setIntervalCalls++;
  return realSetInterval.apply(this, args);
};
Math.random = function countedRandom() {
  randomCalls++;
  return realRandom();
};
process.env = new Proxy(realEnv, {
  get(target, prop, receiver) {
    if (typeof prop === 'string') envReadKeys.push(prop);
    return Reflect.get(target, prop, receiver);
  },
});

const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

// ---------- import the barrel under instrumentation ----------

section('1. importing the contracts barrel is side-effect free');
const mod = await import('../../../dist/foundation/contracts/index.js');

check('no Date.now() during import', dateNowCalls === 0, `${dateNowCalls} calls`);
check('fetch denial negative control is active', fetchDenial.negativeControlProven);
check('no fetch during import', fetchDenial.attempts() === 0, `${fetchDenial.attempts()} calls`);
check('no setTimeout during import', setTimeoutCalls === 0, `${setTimeoutCalls} calls`);
check('no setInterval during import', setIntervalCalls === 0, `${setIntervalCalls} calls`);
check('no Math.random during import', randomCalls === 0, `${randomCalls} calls`);
const moduleEnvReads = envReadKeys.filter((k) => !NODE_LOADER_ENV_KEYS.has(k));
check('no process.env reads during import (beyond Node loader internals)', moduleEnvReads.length === 0, moduleEnvReads.join(','));

const newGlobals = Object.getOwnPropertyNames(globalThis).filter((k) => !globalsBefore.has(k));
check('no new globals created', newGlobals.length === 0, newGlobals.join(','));

// ---------- restore runtime ----------
Date.now = realDateNow;
fetchDenial.restore();
globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
Math.random = realRandom;
process.env = realEnv;

// ---------- exports are actually there (barrel is not an empty shell) ----------

section('2. barrel exposes the frozen contract surface');
const expectedFunctions = [
  'isDataAuthority',
  'isLiveAuthority',
  'weakestAuthority',
  'downgradeAuthority',
  'isKnown',
  'isValidUtcMillis',
  'validateSourcedTimestamp',
  'createSourcedTimestamp',
  'evaluateFreshness',
  'createStructuredFailure',
  'serializeStructuredFailure',
  'failureFromIssues',
  'canonicalJson',
  'stableHash64Hex',
  'stableHash128Hex',
  'deriveCommandId',
  'deriveCorrelationId',
  'deriveSourceDecisionId',
  'deriveCanonicalDecisionId',
  'deriveSourceProposalId',
  'deriveCanonicalProposalId',
  'derivePlanId',
  'deriveLegId',
  'deriveEventId',
  'deriveStateRevisionId',
  'deriveConfigVersionId',
  'canTransitionPhase',
  'checkRunModePermitted',
  'canTransitionPlanLifecycle',
  'canTransitionLegLifecycle',
  'checkExecutionModePermitted',
  'validateRiskCheck',
  'deriveRiskVerdict',
  'combineReconciliationStatuses',
  'defaultRecommendationForStatus',
  'validateCanonicalOpportunity',
  'compareCanonicalOpportunities',
  'deriveClientOrderId',
  'isValidClientOrderId',
  'isSecretLikeKey',
  'findSecretLikePaths',
  'createDiagnosticEnvelope',
  'guardDiagnosticEnvelope',
];
for (const name of expectedFunctions) {
  check(`exports ${name}()`, typeof mod[name] === 'function');
}
const expectedVocab = [
  'DATA_AUTHORITIES',
  'RUN_MODES',
  'DESIRED_RUNTIME_STATES',
  'RUNTIME_PHASES',
  'CONTROL_COMMANDS',
  'EXECUTION_MODES',
  'PLAN_LIFECYCLES',
  'LEG_LIFECYCLES',
  'RISK_CHECK_STATUSES',
  'RECONCILIATION_STATUSES',
  'RECONCILIATION_RECOMMENDATIONS',
  'STRATEGY_SOURCES',
  'CANONICAL_LIFECYCLES',
  'VENUES',
  'TRANSPORT_OUTCOMES',
];
for (const name of expectedVocab) {
  check(`exports ${name}[]`, Array.isArray(mod[name]) && mod[name].length > 0);
}
check('LIVE_EXECUTION_BLOCK_CODE frozen value', mod.LIVE_EXECUTION_BLOCK_CODE === 'LIVE_EXECUTION_NOT_IMPLEMENTED');

// ---------- using the module still reads no wall clock ----------

section('3. contract helpers never reach for the wall clock at use time');
let useTimeNowCalls = 0;
Date.now = function countedUseNow() {
  useTimeNowCalls++;
  return realDateNow();
};
const NOW = 1_700_000_000_000;
const stamp = mod.createSourcedTimestamp({
  sourceTimeMs: NOW - 100,
  receivedAtMs: NOW - 50,
  maxAgeMs: 1_000,
  authority: 'SYNTHETIC_TEST',
  completeness: 'COMPLETE',
  sourceId: 'test.fixture',
});
mod.evaluateFreshness(stamp, NOW);
mod.deriveCommandId({ command: 'START', scope: 'runtime', revision: 1 });
mod.deriveRiskVerdict({
  correlationId: 'corr_contract_purity',
  checks: [{ code: 'KILL_SWITCH', status: 'PASS', blocking: true, detail: 'off', observed: null, limit: null, evidenceTimestamp: null }],
  evaluatedAt: NOW,
  ttlMs: 1_000,
  maxAllowedSize: 1,
});
mod.checkRunModePermitted('EXECUTION_LIVE', { nowMs: NOW, correlationId: 'cor_x' });
mod.createDiagnosticEnvelope(
  { kind: 'test.kind', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: { a: 1 } },
  NOW,
);
Date.now = realDateNow;
check('freshness/IDs/verdicts/envelopes used zero Date.now()', useTimeNowCalls === 0, `${useTimeNowCalls} calls`);

// ---------- static proof: compiled contracts contain no I/O primitives ----------

section('4. compiled contract sources are statically free of I/O primitives');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../dist/foundation/contracts');
  const files = readdirSync(distDir).filter((f) => f.endsWith('.js'));
  check('all 12 compiled modules present', files.length === 12, files.join(','));
  const forbidden = [
    ['process.env', /process\.env/],
    ['Date.now', /Date\.now/],
    ['new Date(', /new Date\(/],
    ['Math.random', /Math\.random/],
    ['fetch(', /\bfetch\s*\(/],
    ['setTimeout', /setTimeout/],
    ['setInterval', /setInterval/],
    ["node:fs / require('fs')", /node:fs|require\(['"]fs['"]\)/],
    ['node:http(s)', /node:https?|require\(['"]https?['"]\)/],
    ['node:net / ws', /node:net|require\(['"]ws['"]\)|from ['"]ws['"]/],
  ];
  /** Strip block and line comments so doc text cannot trip the scan. */
  function codeOnly(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  for (const [label, pattern] of forbidden) {
    const offenders = files.filter((f) => pattern.test(codeOnly(readFileSync(join(distDir, f), 'utf8'))));
    check(`no ${label} in any contract module`, offenders.length === 0, offenders.join(','));
  }
}

// ---------- summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
