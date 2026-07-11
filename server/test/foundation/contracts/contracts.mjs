#!/usr/bin/env node
/**
 * Foundation contract kernel — conformance proof. ZERO network, ZERO env,
 * fixed injected clocks only (NOW constant below; no Date.now() in any
 * assertion path).
 * Run after `npm run build -w server`:
 *   node server/test/foundation/contracts/contracts.mjs
 * Prints ✓/✗ per case and exits non-zero on any failure.
 */
import {
  // authority
  DATA_AUTHORITIES,
  isDataAuthority,
  isLiveAuthority,
  isPrivateAuthority,
  weakestAuthority,
  downgradeAuthority,
  isKnown,
  // time
  MAX_UTC_MS,
  isValidUtcMillis,
  validateSourcedTimestamp,
  createSourcedTimestamp,
  evaluateFreshness,
  // failures
  createStructuredFailure,
  isStructuredFailure,
  validateStructuredFailure,
  serializeStructuredFailure,
  failureFromIssues,
  ok,
  fail,
  // identity
  canonicalJson,
  stableHash64Hex,
  stableHash128Hex,
  deriveCommandId,
  deriveCorrelationId,
  deriveSourceDecisionId,
  deriveCanonicalDecisionId,
  deriveSourceProposalId,
  deriveCanonicalProposalId,
  derivePlanId,
  deriveLegId,
  deriveEventId,
  deriveStateRevisionId,
  deriveConfigVersionId,
  // runtime
  RUN_MODES,
  RUNTIME_PHASES,
  CONTROL_COMMANDS,
  DESIRED_RUNTIME_STATES,
  isRunMode,
  isRuntimePhase,
  isControlCommand,
  isDesiredRuntimeState,
  canTransitionPhase,
  checkRunModePermitted,
  LIVE_EXECUTION_BLOCK_CODE,
  // execution
  EXECUTION_MODES,
  PLAN_LIFECYCLES,
  LEG_LIFECYCLES,
  isExecutionMode,
  isPlanLifecycle,
  isLegLifecycle,
  isTerminalPlanLifecycle,
  isTerminalLegLifecycle,
  canTransitionPlanLifecycle,
  canTransitionLegLifecycle,
  checkExecutionModePermitted,
  // risk
  isRiskCheckStatus,
  isActionRiskClass,
  validateRiskCheck,
  deriveRiskVerdict,
  // reconciliation
  RECONCILIATION_STATUSES,
  RECONCILIATION_RECOMMENDATIONS,
  isReconciliationStatus,
  isReconciliationRecommendation,
  combineReconciliationStatuses,
  defaultRecommendationForStatus,
  // opportunity
  isStrategySource,
  isCanonicalLifecycle,
  validateCanonicalOpportunity,
  compareCanonicalOpportunities,
  // exchange
  isVenue,
  isTransportOutcome,
  isValidClientOrderId,
  deriveClientOrderId,
  CLIENT_ORDER_ID_MAX_LENGTH,
  // diagnostics
  isHealthState,
  isSecretLikeKey,
  findSecretLikePaths,
  findSerializabilityIssues,
  createDiagnosticEnvelope,
  guardDiagnosticEnvelope,
  ENVELOPE_VERSION,
} from '../../../dist/foundation/contracts/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

/** Fixed injected clock. Never Date.now(). */
const NOW = 1_700_000_000_000;
const CID = 'cor_test0000000000';

function ts(over = {}) {
  return {
    sourceTimeMs: NOW - 1_000,
    receivedAtMs: NOW - 500,
    maxAgeMs: 5_000,
    authority: 'LIVE_PUBLIC',
    completeness: 'COMPLETE',
    sourceId: 'binance.usdm.bookTicker',
    ...over,
  };
}

function failureFixture(over = {}) {
  return {
    component: 'foundation.contracts.test',
    stage: 'unit',
    code: 'TEST_FAILURE',
    message: 'synthetic failure for conformance tests',
    occurredAt: NOW,
    retryable: false,
    safeCurrentState: 'STOPPED',
    recommendedOperatorAction: 'None — synthetic.',
    correlationId: CID,
    ...over,
  };
}

// =====================================================================
section('1. time — timestamps validate (reject NaN/negative/malformed/out-of-range)');
{
  check('valid timestamp accepted', validateSourcedTimestamp(ts()).length === 0);
  const frozen = createSourcedTimestamp(ts());
  check('createSourcedTimestamp freezes', Object.isFrozen(frozen));
  check('NaN receivedAtMs rejected', validateSourcedTimestamp(ts({ receivedAtMs: NaN })).length > 0);
  check('negative receivedAtMs rejected', validateSourcedTimestamp(ts({ receivedAtMs: -5 })).length > 0);
  check('float receivedAtMs rejected', validateSourcedTimestamp(ts({ receivedAtMs: NOW + 0.5 })).length > 0);
  check('out-of-range (year 2100+) rejected', validateSourcedTimestamp(ts({ receivedAtMs: MAX_UTC_MS + 1 })).length > 0);
  check('NaN sourceTimeMs rejected', validateSourcedTimestamp(ts({ sourceTimeMs: NaN })).length > 0);
  check('null sourceTimeMs accepted (unknown stays unknown)', validateSourcedTimestamp(ts({ sourceTimeMs: null })).length === 0);
  check('zero maxAgeMs rejected', validateSourcedTimestamp(ts({ maxAgeMs: 0 })).length > 0);
  check('negative maxAgeMs rejected', validateSourcedTimestamp(ts({ maxAgeMs: -1 })).length > 0);
  check('bad authority rejected', validateSourcedTimestamp(ts({ authority: 'LIVE' })).length > 0);
  check('bad completeness rejected', validateSourcedTimestamp(ts({ completeness: 'FULL' })).length > 0);
  check('empty sourceId rejected', validateSourcedTimestamp(ts({ sourceId: '  ' })).length > 0);
  check('non-object rejected', validateSourcedTimestamp('nope').length > 0);
  check('createSourcedTimestamp throws on invalid', throws(() => createSourcedTimestamp(ts({ maxAgeMs: NaN }))));
  check('isValidUtcMillis rejects NaN/negative/float', !isValidUtcMillis(NaN) && !isValidUtcMillis(-1) && !isValidUtcMillis(1.5));
}

// =====================================================================
section('2. time — source event time is never overwritten by receipt time');
{
  const v = createSourcedTimestamp(ts());
  check('sourceTimeMs preserved', v.sourceTimeMs === NOW - 1_000);
  check('receivedAtMs preserved separately', v.receivedAtMs === NOW - 500);
  const report = evaluateFreshness(v, NOW);
  check('freshness judged on SOURCE_TIME when present', report.basis === 'SOURCE_TIME' && report.ageMs === 1_000);
  const noSource = evaluateFreshness(createSourcedTimestamp(ts({ sourceTimeMs: null })), NOW);
  check('falls back to RECEIPT_TIME only when source absent', noSource.basis === 'RECEIPT_TIME' && noSource.ageMs === 500);
}

// =====================================================================
section('3. time — freshness against an injected clock');
{
  check('fresh within maxAge', evaluateFreshness(ts(), NOW).state === 'FRESH');
  check('exact maxAge boundary is FRESH', evaluateFreshness(ts({ sourceTimeMs: NOW - 5_000 }), NOW).state === 'FRESH');
  const stale = evaluateFreshness(ts(), NOW + 10_000);
  check('stale beyond maxAge', stale.state === 'STALE');
  check('stale live data downgrades to UNAVAILABLE', stale.effectiveAuthority === 'UNAVAILABLE');
  const skewed = evaluateFreshness(ts({ sourceTimeMs: NOW + 60_000 }), NOW);
  check('future-dated fact => CLOCK_SKEWED', skewed.state === 'CLOCK_SKEWED');
  check('skewed fact loses authority', skewed.effectiveAuthority === 'UNAVAILABLE');
  const a = evaluateFreshness(ts(), NOW);
  const b = evaluateFreshness(ts(), NOW);
  check('deterministic: same inputs => identical report', JSON.stringify(a) === JSON.stringify(b));
  check('report is frozen', Object.isFrozen(a));
  check('throws on NaN clock', throws(() => evaluateFreshness(ts(), NaN)));
  check('throws on invalid timestamp', throws(() => evaluateFreshness(ts({ maxAgeMs: -1 }), NOW)));
}

// =====================================================================
section('4. authority — unavailable stays unavailable; downgrade never upgrades');
{
  const un = evaluateFreshness(ts({ completeness: 'UNAVAILABLE' }), NOW);
  check('UNAVAILABLE completeness => UNAVAILABLE state, null age', un.state === 'UNAVAILABLE' && un.ageMs === null && un.basis === 'NONE');
  const unAuth = evaluateFreshness(ts({ authority: 'UNAVAILABLE' }), NOW);
  check('UNAVAILABLE authority => UNAVAILABLE state', unAuth.state === 'UNAVAILABLE' && unAuth.effectiveAuthority === 'UNAVAILABLE');
  check('downgrade: FRESH keeps authority', downgradeAuthority('LIVE_PRIVATE', 'FRESH') === 'LIVE_PRIVATE');
  check('downgrade: STALE live => UNAVAILABLE', downgradeAuthority('LIVE_PUBLIC', 'STALE') === 'UNAVAILABLE');
  check('downgrade: stale replay => UNAVAILABLE too', downgradeAuthority('RECORDED_REPLAY', 'STALE') === 'UNAVAILABLE');
  check('downgrade: UNAVAILABLE never re-emerges', downgradeAuthority('UNAVAILABLE', 'FRESH') === 'UNAVAILABLE');
  check('downgrade throws on invalid freshness', throws(() => downgradeAuthority('LIVE_PUBLIC', 'OKAYISH')));
  check('all six authorities recognized', DATA_AUTHORITIES.length === 6 && DATA_AUTHORITIES.every(isDataAuthority));
  check('isDataAuthority rejects junk', !isDataAuthority('LIVE') && !isDataAuthority(42) && !isDataAuthority('live_public'));
  check('isLiveAuthority truth table', isLiveAuthority('LIVE_PUBLIC') && isLiveAuthority('LIVE_PRIVATE') && isLiveAuthority('DERIVED_LIVE') && !isLiveAuthority('RECORDED_REPLAY') && !isLiveAuthority('SYNTHETIC_TEST') && !isLiveAuthority('UNAVAILABLE'));
  check('isPrivateAuthority only LIVE_PRIVATE', isPrivateAuthority('LIVE_PRIVATE') && !isPrivateAuthority('LIVE_PUBLIC'));
  check('weakestAuthority picks the weaker', weakestAuthority('LIVE_PRIVATE', 'SYNTHETIC_TEST') === 'SYNTHETIC_TEST');
  check('weakestAuthority: UNAVAILABLE dominates', weakestAuthority('LIVE_PUBLIC', 'UNAVAILABLE', 'DERIVED_LIVE') === 'UNAVAILABLE');
  check('weakestAuthority throws on empty', throws(() => weakestAuthority()));
  check('weakestAuthority throws on invalid member', throws(() => weakestAuthority('LIVE_PUBLIC', 'BOGUS')));
}

// =====================================================================
section('5. authority — explicit unknown-value discipline');
{
  check('null is not known', !isKnown(null));
  check('undefined is not known', !isKnown(undefined));
  check("'UNKNOWN' is not known", !isKnown('UNKNOWN'));
  check("'UNAVAILABLE' is not known", !isKnown('UNAVAILABLE'));
  check('0 IS a known value', isKnown(0));
  check('false IS a known value', isKnown(false));
  check('empty string IS a known value', isKnown(''));
}

// =====================================================================
section('6. identity — stable IDs reproduce (pure functions of semantic inputs)');
{
  const cmdInput = { command: 'START', scope: 'runtime', revision: 7 };
  const id1 = deriveCommandId(cmdInput);
  const id2 = deriveCommandId({ ...cmdInput });
  check('same inputs => same command ID', id1 === id2, id1);
  check('different revision => different ID', deriveCommandId({ ...cmdInput, revision: 8 }) !== id1);
  check('cmd_ prefix + 16 hex', /^cmd_[0-9a-f]{16}$/.test(id1));

  // wall-clock independence: patch Date.now around calls
  const realNow = Date.now;
  Date.now = () => 1;
  const atT1 = deriveCommandId(cmdInput);
  Date.now = () => 999_999_999_999;
  const atT2 = deriveCommandId(cmdInput);
  Date.now = realNow;
  check('ID independent of wall clock', atT1 === atT2 && atT1 === id1);

  const cor = deriveCorrelationId({ origin: 'command', key: id1 });
  check('correlation ID reproduces', cor === deriveCorrelationId({ origin: 'command', key: id1 }) && cor.startsWith('cor_'));

  const sdec = deriveSourceDecisionId({ source: 'BASIS', engineKey: 'TESTUSDT:1700000000000:watch' });
  const cdec = deriveCanonicalDecisionId({ source: 'BASIS', sourceRecordId: sdec, symbol: 'TESTUSDT' });
  const sprop = deriveSourceProposalId({ source: 'VOLUME', engineKey: 'proposal-42' });
  const cprop = deriveCanonicalProposalId({ source: 'VOLUME', sourceRecordId: sprop, symbol: 'DORMUSDT' });
  check('decision/proposal ID prefixes', sdec.startsWith('sdec_') && cdec.startsWith('cdec_') && sprop.startsWith('sprop_') && cprop.startsWith('cprop_'));
  check('decision vs proposal namespaces differ for same key', deriveSourceDecisionId({ source: 'BASIS', engineKey: 'k1' }).slice(5) !== deriveSourceProposalId({ source: 'BASIS', engineKey: 'k1' }).slice(6));

  const plan = derivePlanId({ canonicalProposalId: cprop, attempt: 0 });
  const leg = deriveLegId({ planId: plan, legRole: 'SPOT_ENTRY' });
  check('plan/leg reproduce', plan === derivePlanId({ canonicalProposalId: cprop, attempt: 0 }) && leg === deriveLegId({ planId: plan, legRole: 'SPOT_ENTRY' }));
  check('leg role changes ID (never positional)', deriveLegId({ planId: plan, legRole: 'PERP_HEDGE' }) !== leg);

  const evtA = deriveEventId({ streamId: 'plan:x/lifecycle', sequence: 5 });
  const evtB = deriveEventId({ streamId: 'plan:x/lifecycle', sequence: '5' });
  check('event ID reproduces; numeric vs string sequence distinct', evtA === deriveEventId({ streamId: 'plan:x/lifecycle', sequence: 5 }) && evtA !== evtB);

  const rev = deriveStateRevisionId({ scope: 'controlPlane.runtime', revision: 3 });
  check('state revision ID reproduces', rev === deriveStateRevisionId({ scope: 'controlPlane.runtime', revision: 3 }) && rev.startsWith('rev_'));

  const cfg1 = deriveConfigVersionId({ scope: 'foundation.risk', payload: { a: 1, b: [1, 2] } });
  const cfg2 = deriveConfigVersionId({ scope: 'foundation.risk', payload: { b: [1, 2], a: 1 } });
  check('config version is content-addressed (key order irrelevant)', cfg1 === cfg2 && cfg1.startsWith('cfg_'));
  check('different config => different version', deriveConfigVersionId({ scope: 'foundation.risk', payload: { a: 2, b: [1, 2] } }) !== cfg1);
}

// =====================================================================
section('7. identity — invalid inputs fail, canonical JSON is honest');
{
  check('empty command throws', throws(() => deriveCommandId({ command: '', scope: 'runtime', revision: 1 })));
  check('whitespace scope throws', throws(() => deriveCommandId({ command: 'START', scope: '   ', revision: 1 })));
  check('negative revision throws', throws(() => deriveCommandId({ command: 'START', scope: 'runtime', revision: -1 })));
  check('NaN attempt throws', throws(() => derivePlanId({ canonicalProposalId: 'cprop_x', attempt: NaN })));
  check('canonicalJson: key order invariant', canonicalJson({ a: 1, b: 2 }) === canonicalJson({ b: 2, a: 1 }));
  check('canonicalJson rejects NaN', throws(() => canonicalJson({ x: NaN })));
  check('canonicalJson rejects undefined value', throws(() => canonicalJson({ x: undefined })));
  check('canonicalJson rejects function', throws(() => canonicalJson({ x: () => 1 })));
  check('canonicalJson rejects bigint', throws(() => canonicalJson({ x: 1n })));
  check('canonicalJson rejects Date instance', throws(() => canonicalJson({ x: new Date(0) })));
  const cyc = { a: 1 };
  cyc.self = cyc;
  check('canonicalJson rejects cycles', throws(() => canonicalJson(cyc)));
  check('stableHash64Hex: 16 hex, deterministic', /^[0-9a-f]{16}$/.test(stableHash64Hex('abc')) && stableHash64Hex('abc') === stableHash64Hex('abc'));
  const h128 = stableHash128Hex('abc');
  check('stableHash128Hex: 32 hex, lanes independent', /^[0-9a-f]{32}$/.test(h128) && h128.slice(0, 16) !== h128.slice(16));
}

// =====================================================================
section('8. exchange — client-order IDs fit the venue constraint');
{
  const input = { planId: 'plan_0123456789abcdef', legId: 'leg_fedcba9876543210', attempt: 0 };
  const cid1 = deriveClientOrderId(input);
  check('reproduces exactly', cid1 === deriveClientOrderId({ ...input }), cid1);
  check('matches ^[a-zA-Z0-9_-]{1,36}$', isValidClientOrderId(cid1));
  check('length <= 36 even at attempt 999', deriveClientOrderId({ ...input, attempt: 999 }).length <= CLIENT_ORDER_ID_MAX_LENGTH);
  check('different leg => different ID', deriveClientOrderId({ ...input, legId: 'leg_other' }) !== cid1);
  check('different attempt => different ID', deriveClientOrderId({ ...input, attempt: 1 }) !== cid1);
  check('attempt 1000 throws', throws(() => deriveClientOrderId({ ...input, attempt: 1000 })));
  check('negative attempt throws', throws(() => deriveClientOrderId({ ...input, attempt: -1 })));
  check('empty planId throws', throws(() => deriveClientOrderId({ ...input, planId: '' })));
  check('isValidClientOrderId rejects overlong', !isValidClientOrderId('x'.repeat(37)));
  check('isValidClientOrderId rejects bad chars', !isValidClientOrderId('has space') && !isValidClientOrderId('dot.dot') && !isValidClientOrderId(''));
  check('venue guard', isVenue('BINANCE_USDM') && isVenue('BINANCE_SPOT') && !isVenue('BINANCE'));
  check('transport outcome guard incl. AMBIGUOUS', isTransportOutcome('AMBIGUOUS') && isTransportOutcome('TIMEOUT') && !isTransportOutcome('LOST'));
}

// =====================================================================
section('9. failures — structured failures carry the exact nine fields');
{
  const f = createStructuredFailure(failureFixture());
  check('valid failure constructs and freezes', isStructuredFailure(f) && Object.isFrozen(f));
  check('missing correlationId rejected', validateStructuredFailure({ ...failureFixture(), correlationId: undefined }).length > 0);
  check('unknown extra field rejected', validateStructuredFailure({ ...failureFixture(), bonus: 1 }).length > 0);
  check('lowercase code rejected', validateStructuredFailure(failureFixture({ code: 'not_upper' })).length > 0);
  check('NaN occurredAt rejected', validateStructuredFailure(failureFixture({ occurredAt: NaN })).length > 0);
  check('negative occurredAt rejected', validateStructuredFailure(failureFixture({ occurredAt: -1 })).length > 0);
  check('non-boolean retryable rejected', validateStructuredFailure(failureFixture({ retryable: 'yes' })).length > 0);
  check('constructor throws on invalid', throws(() => createStructuredFailure(failureFixture({ message: '' }))));
}

// =====================================================================
section('10. failures — safe deterministic serialization');
{
  const f = createStructuredFailure(failureFixture());
  const s1 = serializeStructuredFailure(f);
  const s2 = serializeStructuredFailure(f);
  check('byte-identical across calls', s1 === s2);
  const parsed = JSON.parse(s1);
  const keys = Object.keys(parsed);
  check('exactly the nine contract fields', keys.length === 9);
  check('canonical field order', keys.join(',') === 'component,stage,code,message,occurredAt,retryable,safeCurrentState,recommendedOperatorAction,correlationId');
  check('values survive round-trip', parsed.code === 'TEST_FAILURE' && parsed.occurredAt === NOW && parsed.retryable === false);
  check('serialize rejects non-failures', throws(() => serializeStructuredFailure({ hello: 'world' })));
  const promoted = failureFromIssues(
    [{ path: 'maxAgeMs', code: 'POSITIVE_INTEGER_REQUIRED', message: 'must be > 0' }],
    { component: 'foundation.contracts.test', stage: 'unit', occurredAt: NOW, correlationId: CID },
  );
  check('failureFromIssues embeds issue detail', promoted.code === 'CONTRACT_VALIDATION_FAILED' && promoted.message.includes('maxAgeMs') && promoted.message.includes('POSITIVE_INTEGER_REQUIRED'));
  check('failureFromIssues throws on empty issues', throws(() => failureFromIssues([], { component: 'c', stage: 's', occurredAt: NOW, correlationId: CID })));
  const okRes = ok(42);
  const failRes = fail(f);
  check('ContractResult ok/fail envelopes', okRes.ok === true && okRes.value === 42 && failRes.ok === false && failRes.failure.code === 'TEST_FAILURE' && Object.isFrozen(okRes) && Object.isFrozen(failRes));
}

// =====================================================================
section('11. runtime — vocabulary guards (invalid variants fail)');
{
  check('all run modes valid', RUN_MODES.length === 3 && RUN_MODES.every(isRunMode));
  check('all phases valid', RUNTIME_PHASES.length === 10 && RUNTIME_PHASES.every(isRuntimePhase));
  check('all commands valid', CONTROL_COMMANDS.length === 6 && CONTROL_COMMANDS.every(isControlCommand));
  check('all desired states valid', DESIRED_RUNTIME_STATES.length === 3 && DESIRED_RUNTIME_STATES.every(isDesiredRuntimeState));
  check('junk variants rejected', !isRunMode('LIVE') && !isRuntimePhase('BOOTING') && !isControlCommand('KILL') && !isDesiredRuntimeState('HALTED'));
}

// =====================================================================
section('12. runtime — phase transition law');
{
  check('STOPPED -> VALIDATING legal', canTransitionPhase('STOPPED', 'VALIDATING'));
  check('STOPPED -> RUNNING illegal (no jump past startup)', !canTransitionPhase('STOPPED', 'RUNNING'));
  check('RUNNING -> DEGRADED legal', canTransitionPhase('RUNNING', 'DEGRADED'));
  check('DEGRADED -> RUNNING legal (recovery)', canTransitionPhase('DEGRADED', 'RUNNING'));
  check('PAUSED -> RUNNING legal (resume)', canTransitionPhase('PAUSED', 'RUNNING'));
  check('STOPPING -> STOPPED legal', canTransitionPhase('STOPPING', 'STOPPED'));
  check('RUNNING -> STOPPED illegal (must pass STOPPING)', !canTransitionPhase('RUNNING', 'STOPPED'));
  check('FAILED -> RUNNING illegal (must re-validate)', !canTransitionPhase('FAILED', 'RUNNING'));
  check('BLOCKED -> VALIDATING legal', canTransitionPhase('BLOCKED', 'VALIDATING'));
  check('unknown phase throws (not silently illegal)', throws(() => canTransitionPhase('BOOTING', 'RUNNING')));
}

// =====================================================================
section('13. runtime — EXECUTION_LIVE stays blocked');
{
  const ctx = { nowMs: NOW, correlationId: CID };
  check('INTELLIGENCE permitted', checkRunModePermitted('INTELLIGENCE', ctx).ok === true);
  check('EXECUTION_VALIDATE_ONLY permitted', checkRunModePermitted('EXECUTION_VALIDATE_ONLY', ctx).ok === true);
  const live = checkRunModePermitted('EXECUTION_LIVE', ctx);
  check('EXECUTION_LIVE blocked', live.ok === false);
  check(`block code is ${LIVE_EXECUTION_BLOCK_CODE}`, !live.ok && live.failure.code === LIVE_EXECUTION_BLOCK_CODE);
  check('block is not retryable and carries correlation', !live.ok && live.failure.retryable === false && live.failure.correlationId === CID && live.failure.occurredAt === NOW);
  const junk = checkRunModePermitted('YOLO_MODE', ctx);
  check('unknown mode => INVALID_RUN_MODE failure', junk.ok === false && junk.failure.code === 'INVALID_RUN_MODE');
  check('throws on invalid injected clock', throws(() => checkRunModePermitted('INTELLIGENCE', { nowMs: NaN, correlationId: CID })));
}

// =====================================================================
section('14. execution — modes and lifecycle laws');
{
  const ctx = { nowMs: NOW, correlationId: CID };
  check('all execution modes valid', EXECUTION_MODES.length === 3 && EXECUTION_MODES.every(isExecutionMode));
  check('VALIDATE_ONLY permitted', checkExecutionModePermitted('VALIDATE_ONLY', ctx).ok === true);
  check('PAPER permitted', checkExecutionModePermitted('PAPER', ctx).ok === true);
  const liveManual = checkExecutionModePermitted('LIVE_MANUAL', ctx);
  check('LIVE_MANUAL blocked with the live-execution code', liveManual.ok === false && liveManual.failure.code === LIVE_EXECUTION_BLOCK_CODE);
  const junk = checkExecutionModePermitted('SEND_IT', ctx);
  check('unknown mode => INVALID_EXECUTION_MODE', junk.ok === false && junk.failure.code === 'INVALID_EXECUTION_MODE');

  check('15 plan states, 10 leg states', PLAN_LIFECYCLES.length === 15 && LEG_LIFECYCLES.length === 10);
  check('plan/leg guards reject junk', !isPlanLifecycle('OPEN') && !isLegLifecycle('SENT'));
  check('CREATED -> AWAITING_APPROVAL legal', canTransitionPlanLifecycle('CREATED', 'AWAITING_APPROVAL'));
  check('CREATED -> OPENING illegal (no gate skipping)', !canTransitionPlanLifecycle('CREATED', 'OPENING'));
  check('READY -> OPENING legal', canTransitionPlanLifecycle('READY', 'OPENING'));
  check('OPENING -> ONE_LEG_EXPOSED legal', canTransitionPlanLifecycle('OPENING', 'ONE_LEG_EXPOSED'));
  check('ONE_LEG_EXPOSED -> CLOSED illegal (exposure never silently discarded)', !canTransitionPlanLifecycle('ONE_LEG_EXPOSED', 'CLOSED'));
  check('RECOVERY_REQUIRED -> CLOSED illegal (must reconcile/close first)', !canTransitionPlanLifecycle('RECOVERY_REQUIRED', 'CLOSED'));
  check('CLOSING -> CLOSED legal', canTransitionPlanLifecycle('CLOSING', 'CLOSED'));
  check('RECONCILING -> CLOSED legal', canTransitionPlanLifecycle('RECONCILING', 'CLOSED'));
  check('CLOSED is terminal', isTerminalPlanLifecycle('CLOSED') && !canTransitionPlanLifecycle('CLOSED', 'OPENING'));
  check('EXPIRED/CANCELLED/FAILED terminal', isTerminalPlanLifecycle('EXPIRED') && isTerminalPlanLifecycle('CANCELLED') && isTerminalPlanLifecycle('FAILED'));
  check('HEDGED_OPEN not terminal', !isTerminalPlanLifecycle('HEDGED_OPEN'));

  check('PLANNED -> SUBMITTING illegal (must validate)', !canTransitionLegLifecycle('PLANNED', 'SUBMITTING'));
  check('VALIDATED -> SUBMITTING legal', canTransitionLegLifecycle('VALIDATED', 'SUBMITTING'));
  check('SUBMITTING -> AMBIGUOUS legal (lost response is a state)', canTransitionLegLifecycle('SUBMITTING', 'AMBIGUOUS'));
  check('AMBIGUOUS resolves to FILLED', canTransitionLegLifecycle('AMBIGUOUS', 'FILLED'));
  check('AMBIGUOUS is not terminal', !isTerminalLegLifecycle('AMBIGUOUS'));
  check('CANCEL_PENDING -> FILLED legal (cancel/fill race)', canTransitionLegLifecycle('CANCEL_PENDING', 'FILLED'));
  check('FILLED is terminal', isTerminalLegLifecycle('FILLED') && !canTransitionLegLifecycle('FILLED', 'CANCELLED'));
  check('unknown leg state throws', throws(() => canTransitionLegLifecycle('SENT', 'FILLED')));
}

// =====================================================================
section('15. risk — fail-closed verdict derivation');
{
  const passCheck = { code: 'KILL_SWITCH', status: 'PASS', blocking: true, detail: 'kill switch off', observed: 'off', limit: 'off', evidenceTimestamp: NOW - 100 };
  const failCheck = { code: 'MAX_GROSS_NOTIONAL', status: 'FAIL', blocking: true, detail: 'gross too large', observed: 12_000, limit: 10_000, evidenceTimestamp: NOW - 50 };
  const unknownCheck = { code: 'BORROW_AVAILABILITY', status: 'UNKNOWN', blocking: true, detail: 'borrow truth unavailable', observed: null, limit: null, evidenceTimestamp: null };
  const softFail = { code: 'SPREAD_WIDE', status: 'FAIL', blocking: false, detail: 'advisory only', observed: 0.4, limit: 0.2, evidenceTimestamp: NOW - 10 };

  const allow = deriveRiskVerdict({ checks: [passCheck], evaluatedAt: NOW, ttlMs: 3_000 });
  check('all blocking PASS => allowed', allow.allowed === true && allow.blockingCodes.length === 0);
  check('expiresAt = evaluatedAt + ttl', allow.expiresAt === NOW + 3_000 && allow.evaluatedAt === NOW);
  check('verdict and checks frozen', Object.isFrozen(allow) && Object.isFrozen(allow.checks) && Object.isFrozen(allow.checks[0]));

  const blocked = deriveRiskVerdict({ checks: [passCheck, failCheck], evaluatedAt: NOW, ttlMs: 3_000 });
  check('blocking FAIL blocks', blocked.allowed === false && blocked.blockingCodes.join(',') === 'MAX_GROSS_NOTIONAL');

  const unknownBlocked = deriveRiskVerdict({ checks: [passCheck, unknownCheck], evaluatedAt: NOW, ttlMs: 3_000 });
  check('blocking UNKNOWN fails closed', unknownBlocked.allowed === false && unknownBlocked.blockingCodes.includes('BORROW_AVAILABILITY'));
  check('unknown evidence stays null (no fabricated 0)', unknownBlocked.checks[1].observed === null && unknownBlocked.checks[1].evidenceTimestamp === null);

  const advisory = deriveRiskVerdict({ checks: [passCheck, softFail], evaluatedAt: NOW, ttlMs: 3_000 });
  check('non-blocking FAIL does not block but is preserved', advisory.allowed === true && advisory.checks.length === 2 && advisory.checks[1].status === 'FAIL');

  const multi = deriveRiskVerdict({ checks: [failCheck, unknownCheck, passCheck], evaluatedAt: NOW, ttlMs: 1 });
  check('blockingCodes preserve check order', multi.blockingCodes.join(',') === 'MAX_GROSS_NOTIONAL,BORROW_AVAILABILITY');

  check('invalid status rejected', validateRiskCheck({ ...passCheck, status: 'MAYBE' }).length > 0);
  check('lowercase code rejected', validateRiskCheck({ ...passCheck, code: 'kill_switch' }).length > 0);
  check('NaN observed rejected', validateRiskCheck({ ...passCheck, observed: NaN }).length > 0);
  check('deriveRiskVerdict throws on invalid check', throws(() => deriveRiskVerdict({ checks: [{ ...passCheck, status: 'MAYBE' }], evaluatedAt: NOW, ttlMs: 1_000 })));
  check('ttl 0 throws', throws(() => deriveRiskVerdict({ checks: [passCheck], evaluatedAt: NOW, ttlMs: 0 })));
  check('NaN evaluatedAt throws', throws(() => deriveRiskVerdict({ checks: [passCheck], evaluatedAt: NaN, ttlMs: 1_000 })));
  check('status/class guards', isRiskCheckStatus('UNKNOWN') && !isRiskCheckStatus('SKIP') && isActionRiskClass('RISK_REDUCING') && !isActionRiskClass('NEUTRALISH'));
}

// =====================================================================
section('16. reconciliation — severity law and data-only recommendations');
{
  check('7 statuses, 7 recommendations', RECONCILIATION_STATUSES.length === 7 && RECONCILIATION_RECOMMENDATIONS.length === 7);
  check('guards reject junk', !isReconciliationStatus('MATCHED') && !isReconciliationRecommendation('EXECUTE'));
  check('combine: all EXACT => EXACT', combineReconciliationStatuses(['EXACT', 'EXACT']) === 'EXACT');
  check('combine: one DIVERGED poisons', combineReconciliationStatuses(['EXACT', 'PARTIAL', 'DIVERGED']) === 'DIVERGED');
  check('combine: STALE beats PENDING', combineReconciliationStatuses(['PENDING', 'STALE']) === 'STALE');
  check('combine: AMBIGUOUS beats UNAVAILABLE', combineReconciliationStatuses(['UNAVAILABLE', 'AMBIGUOUS']) === 'AMBIGUOUS');
  check('combine throws on empty', throws(() => combineReconciliationStatuses([])));
  check('combine throws on invalid member', throws(() => combineReconciliationStatuses(['EXACT', 'FINE'])));
  check('EXACT => NO_ACTION', defaultRecommendationForStatus('EXACT') === 'NO_ACTION');
  check('PENDING => WAIT', defaultRecommendationForStatus('PENDING') === 'WAIT');
  check('PARTIAL/STALE => REFRESH', defaultRecommendationForStatus('PARTIAL') === 'REFRESH' && defaultRecommendationForStatus('STALE') === 'REFRESH');
  check('AMBIGUOUS/DIVERGED/UNAVAILABLE => MANUAL_REVIEW', defaultRecommendationForStatus('AMBIGUOUS') === 'MANUAL_REVIEW' && defaultRecommendationForStatus('DIVERGED') === 'MANUAL_REVIEW' && defaultRecommendationForStatus('UNAVAILABLE') === 'MANUAL_REVIEW');
  check('invalid status throws', throws(() => defaultRecommendationForStatus('FINE')));
}

// =====================================================================
section('17. opportunity — canonical records preserve, never invent');
{
  const sdec = deriveSourceProposalId({ source: 'BASIS', engineKey: 'p-1' });
  function opp(over = {}) {
    return {
      kind: 'PROPOSAL',
      canonicalId: deriveCanonicalProposalId({ source: 'BASIS', sourceRecordId: sdec, symbol: 'TESTUSDT' }),
      source: 'BASIS',
      sourceId: 'p-1',
      symbol: 'TESTUSDT',
      direction: 'long_spot_short_perp',
      lifecycle: 'OPEN',
      sourceLifecycle: 'proposed',
      observedAt: ts(),
      expiresAtMs: NOW + 60_000,
      sourceLocalRank: 0,
      netEdgePct: 0.42,
      confidence: 0.7,
      borrowState: 'available',
      evidence: { gapPct: 0.8 },
      rejectionReasons: [],
      configVersion: 'cfg_abc',
      ...over,
    };
  }
  check('valid canonical proposal accepted', validateCanonicalOpportunity(opp()).length === 0);
  check('unsupplied edge/confidence stay null', validateCanonicalOpportunity(opp({ netEdgePct: null, confidence: null, sourceLocalRank: null, evidence: null, configVersion: null })).length === 0);
  check('bad source rejected', validateCanonicalOpportunity(opp({ source: 'MOMENTUM' })).length > 0);
  check('confidence > 1 rejected', validateCanonicalOpportunity(opp({ confidence: 1.5 })).length > 0);
  check('bad kind rejected', validateCanonicalOpportunity(opp({ kind: 'IDEA' })).length > 0);
  const badTs = validateCanonicalOpportunity(opp({ observedAt: ts({ receivedAtMs: NaN }) }));
  check('malformed observedAt rejected with nested path', badTs.some((i) => i.path === 'observedAt.receivedAtMs'));
  check('guards work', isStrategySource('VOLUME') && !isStrategySource('BASIS2') && isCanonicalLifecycle('UNKNOWN') && !isCanonicalLifecycle('LIVE'));

  const openBasis0 = opp({ canonicalId: 'cprop_aaa', sourceLocalRank: 0 });
  const openBasis2 = opp({ canonicalId: 'cprop_bbb', sourceLocalRank: 2, netEdgePct: 99.9 });
  const openVolume0 = opp({ canonicalId: 'cprop_ccc', source: 'VOLUME', sourceLocalRank: 0 });
  const closedBasis = opp({ canonicalId: 'cprop_ddd', lifecycle: 'CLOSED', sourceLocalRank: 0 });
  const unranked = opp({ canonicalId: 'cprop_eee', sourceLocalRank: null });

  check('OPEN sorts before CLOSED', compareCanonicalOpportunities(openBasis0, closedBasis) < 0);
  check('same lifecycle: BASIS before VOLUME', compareCanonicalOpportunities(openBasis0, openVolume0) < 0);
  check('rank 0 before rank 2 — huge netEdge does NOT jump the queue', compareCanonicalOpportunities(openBasis0, openBasis2) < 0);
  check('null rank sorts after known rank', compareCanonicalOpportunities(openBasis2, unranked) < 0);
  const arr1 = [unranked, closedBasis, openVolume0, openBasis2, openBasis0].sort(compareCanonicalOpportunities);
  const arr2 = [openBasis2, openBasis0, unranked, openVolume0, closedBasis].sort(compareCanonicalOpportunities);
  check('deterministic total order regardless of input order', arr1.map((o) => o.canonicalId).join(',') === arr2.map((o) => o.canonicalId).join(','));
  check('expected order', arr1.map((o) => o.canonicalId).join(',') === 'cprop_aaa,cprop_bbb,cprop_eee,cprop_ccc,cprop_ddd');
}

// =====================================================================
section('18. diagnostics — secret-like fields are rejected, never stripped');
{
  for (const key of ['apiKey', 'api_key', 'API-KEY', 'secretSauce', 'myPassphrase', 'password', 'authToken', 'privateKey', 'signature', 'listenKey', 'credentialStore', 'x_token']) {
    check(`'${key}' flagged as secret-like`, isSecretLikeKey(key));
  }
  check('benign keys pass', !isSecretLikeKey('symbol') && !isSecretLikeKey('netEdgePct') && !isSecretLikeKey('heartbeatAt'));
  const paths = findSecretLikePaths({ a: { apiKey: 'x' }, list: [{ token: 1 }], clean: 2 });
  check('nested secret paths found', paths.includes('$.a.apiKey') && paths.includes('$.list[0].token') && paths.length === 2);
  check('configurable extra pattern', isSecretLikeKey('internalPin', { extraPatterns: [/pin/i] }) && !isSecretLikeKey('internalPin'));

  const cleanPayload = { phase: 'RUNNING', counts: { universe: 300 } };
  const okEnv = createDiagnosticEnvelope(
    { kind: 'control.statusSnapshot', createdAt: NOW, authority: 'DERIVED_LIVE', correlationId: CID, payload: cleanPayload },
    NOW,
  );
  check('clean envelope accepted', okEnv.ok === true && okEnv.value.envelopeVersion === ENVELOPE_VERSION);
  check('envelope frozen deep', okEnv.ok && Object.isFrozen(okEnv.value) && Object.isFrozen(okEnv.value.payload) && Object.isFrozen(okEnv.value.payload.counts));
  cleanPayload.counts.universe = 999;
  check('payload deep-cloned: later producer mutation invisible', okEnv.ok && okEnv.value.payload.counts.universe === 300);

  const secretPayload = { phase: 'RUNNING', binance: { listenKey: 'abc123' } };
  const rejected = createDiagnosticEnvelope(
    { kind: 'control.statusSnapshot', createdAt: NOW, authority: 'DERIVED_LIVE', correlationId: CID, payload: secretPayload },
    NOW,
  );
  check('secret payload rejected with named failure', rejected.ok === false && rejected.failure.code === 'SECRET_FIELD_REJECTED');
  check('failure names the offending path', !rejected.ok && rejected.failure.message.includes('$.payload.binance.listenKey'));
  check('input NOT stripped into fake success', secretPayload.binance.listenKey === 'abc123');

  const nanRes = createDiagnosticEnvelope({ kind: 'k', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: { x: NaN } }, NOW);
  check('NaN payload => ENVELOPE_NOT_SERIALIZABLE', nanRes.ok === false && nanRes.failure.code === 'ENVELOPE_NOT_SERIALIZABLE');
  const fnRes = createDiagnosticEnvelope({ kind: 'k', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: { f: () => 1 } }, NOW);
  check('function payload rejected', fnRes.ok === false && fnRes.failure.code === 'ENVELOPE_NOT_SERIALIZABLE');
  const cyc = {};
  cyc.self = cyc;
  const cycRes = createDiagnosticEnvelope({ kind: 'k', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: cyc }, NOW);
  check('cyclic payload rejected', cycRes.ok === false && cycRes.failure.code === 'ENVELOPE_NOT_SERIALIZABLE');
  check('findSerializabilityIssues reports paths', findSerializabilityIssues({ a: [undefined] })[0].path === '$.a[0]');

  const badKind = createDiagnosticEnvelope({ kind: '', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: {} }, NOW);
  const badAuth = createDiagnosticEnvelope({ kind: 'k', createdAt: NOW, authority: 'LIVE', correlationId: null, payload: {} }, NOW);
  const badCreated = createDiagnosticEnvelope({ kind: 'k', createdAt: NaN, authority: 'SYNTHETIC_TEST', correlationId: null, payload: {} }, NOW);
  check('malformed envelope fields rejected', badKind.ok === false && badAuth.ok === false && badCreated.ok === false && badKind.failure.code === 'ENVELOPE_FIELDS_INVALID');

  const extraRejected = createDiagnosticEnvelope(
    { kind: 'k', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: { internalPin: 1 } },
    NOW,
    { extraPatterns: [/pin/i] },
  );
  check('extra pattern rejects at envelope level', extraRejected.ok === false && extraRejected.failure.code === 'SECRET_FIELD_REJECTED');

  const reguard = okEnv.ok ? guardDiagnosticEnvelope(okEnv.value, NOW) : { ok: false };
  check('guard round-trips a clean envelope', reguard.ok === true);
  const tampered = okEnv.ok ? guardDiagnosticEnvelope({ ...okEnv.value, payload: { apiKey: 'x' } }, NOW) : { ok: true };
  check('guard rejects a tampered envelope', tampered.ok === false && tampered.failure.code === 'SECRET_FIELD_REJECTED');
  const wrongVersion = guardDiagnosticEnvelope({ envelopeVersion: 2, kind: 'k', createdAt: NOW, authority: 'SYNTHETIC_TEST', correlationId: null, payload: {} }, NOW);
  check('wrong envelope version rejected', wrongVersion.ok === false && wrongVersion.failure.code === 'ENVELOPE_FIELDS_INVALID');
  check('health state guard', isHealthState('DEGRADED') && !isHealthState('FINE'));
}

// ---------- summary ----------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
