#!/usr/bin/env node
/**
 * Lane A — deterministic control-plane proof. ZERO network, ZERO wall clock.
 * Run after `npm run build -w server`:
 *   node server/test/foundation/control/control.mjs
 */
import {
  CONTROL_FAILURE_CODES,
  SUPERVISOR_FAILURE_HISTORY_CAPACITY as FAILURE_HISTORY_CAPACITY,
  SUPERVISOR_TRANSITION_HISTORY_CAPACITY as TRANSITION_HISTORY_CAPACITY,
  createDeterministicSupervisor,
} from '../../../dist/foundation/control/index.js';
import {
  LIVE_EXECUTION_BLOCK_CODE,
  createSourcedTimestamp,
  createStructuredFailure,
} from '../../../dist/foundation/contracts/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

const T0 = 1_800_000_000_000;

function portFailure(component, stage, code, ctx, retryable = false) {
  return createStructuredFailure({
    component,
    stage,
    code,
    message: `${component} ${stage} failed`,
    occurredAt: ctx.nowMs,
    retryable,
    safeCurrentState: 'UNCHANGED',
    recommendedOperatorAction: `Inspect ${component}.`,
    correlationId: ctx.correlationId,
  });
}

function timestamp(atMs, maxAgeMs = 1_000) {
  return createSourcedTimestamp({
    sourceTimeMs: atMs,
    receivedAtMs: atMs,
    maxAgeMs,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'control.test.fixture',
  });
}

function managed(name, options = {}) {
  const state = { validateCalls: 0, startCalls: 0, stopCalls: 0, probeCalls: 0 };
  const log = options.log ?? [];
  const component = {
    name,
    required: options.required ?? true,
    dependsOn: options.dependsOn ?? [],
    requiresPrivateKeys: options.requiresPrivateKeys,
    requiresBorrowTruth: options.requiresBorrowTruth,
    riskIncreasing: options.riskIncreasing,
    stepTimeoutMs: options.stepTimeoutMs,
    validate(ctx) {
      state.validateCalls += 1;
      log.push(`validate:${name}`);
      return options.validate?.(ctx, state) ?? { kind: 'COMPLETE' };
    },
    start(ctx) {
      state.startCalls += 1;
      log.push(`start:${name}`);
      return options.start?.(ctx, state) ?? { kind: 'COMPLETE' };
    },
    stop(ctx) {
      state.stopCalls += 1;
      log.push(`stop:${name}`);
      return options.stop?.(ctx, state) ?? { kind: 'COMPLETE' };
    },
    probe(ctx) {
      state.probeCalls += 1;
      log.push(`probe:${name}`);
      return options.probe?.(ctx, state) ?? {
        heartbeatAt: ctx.nowMs,
        timestamp: timestamp(ctx.nowMs),
        fatal: null,
      };
    },
  };
  return { component, state };
}

function makeSupervisor({
  components,
  gates = [],
  environment = { privateKeysAvailable: true, killSwitchEngaged: false, borrowTruthPresent: true },
  runMode = 'INTELLIGENCE',
  gateTimeoutMs = 10,
  componentTimeoutMs = 10,
}) {
  return createDeterministicSupervisor(
    {
      scope: 'test.control',
      runMode,
      defaultGateTimeoutMs: gateTimeoutMs,
      defaultComponentTimeoutMs: componentTimeoutMs,
    },
    {
      components,
      gates,
      readEnvironment: typeof environment === 'function' ? environment : () => environment,
    },
  );
}

function issue(supervisor, command, revision, nowMs = T0) {
  return supervisor.issue({ command, revision, nowMs });
}

async function flushRejectedTurn() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

// =====================================================================
section('1. dependency-ordered validation/start and reverse stop');
{
  const log = [];
  const market = managed('market', { log });
  const basis = managed('basis', { log, dependsOn: ['market'] });
  const supervisor = makeSupervisor({ components: [basis.component, market.component] });
  const started = issue(supervisor, 'START', 1);
  check('start command accepted', started.ok && started.value.applied);
  check(
    'validate/start follows dependency order',
    log.slice(0, 4).join('|') === 'validate:market|validate:basis|start:market|start:basis',
    log.join('|'),
  );
  check('observed RUNNING is separate from desired RUNNING', supervisor.snapshot().phase === 'RUNNING' && supervisor.snapshot().desiredState === 'RUNNING');
  log.length = 0;
  issue(supervisor, 'STOP', 2, T0 + 1);
  check('stop is exact reverse order', log.filter((entry) => entry.startsWith('stop')).join('|') === 'stop:basis|stop:market', log.join('|'));
  check('stop reaches STOPPED and clears started set', supervisor.snapshot().phase === 'STOPPED' && supervisor.startedComponents().length === 0);
}

// =====================================================================
section('2. blocking preflight stops the chain and marks later gates skipped');
{
  let laterCalls = 0;
  const worker = managed('worker');
  const supervisor = makeSupervisor({
    components: [worker.component],
    gates: [
      { gate: 'config', blocking: true, run: () => ({ status: 'FAIL', detail: 'bad config' }) },
      { gate: 'later', blocking: true, run: () => { laterCalls += 1; return { status: 'PASS' }; } },
    ],
  });
  issue(supervisor, 'START', 1);
  const snapshot = supervisor.snapshot();
  check('blocking gate produces BLOCKED, not fake running', snapshot.phase === 'BLOCKED' && snapshot.desiredState === 'RUNNING');
  check('exact blocked gate exposed', snapshot.blockedAtGate === 'config');
  check('later gate never executed', laterCalls === 0);
  check('later gate explicitly SKIPPED', snapshot.preflight.find((gate) => gate.gate === 'later')?.status === 'SKIPPED');
  check('components never validated after block', worker.state.validateCalls === 0 && worker.state.startCalls === 0);
}

// =====================================================================
section('3. double start is idempotent and does not advance generation');
{
  const worker = managed('worker');
  const supervisor = makeSupervisor({ components: [worker.component] });
  const first = issue(supervisor, 'START', 1);
  const second = issue(supervisor, 'START', 2, T0 + 1);
  check('first start applied', first.ok && first.value.applied);
  check('second start accepted as no-op', second.ok && !second.value.applied);
  check('generation remains one', supervisor.snapshot().generation === 1);
  check('component start called once', worker.state.startCalls === 1);
}

// =====================================================================
section('4. concurrent start is revision-protected; same request is idempotent');
{
  const worker = managed('worker', {
    start: (_ctx, state) => state.startCalls === 1 ? { kind: 'PENDING' } : { kind: 'COMPLETE' },
  });
  const supervisor = makeSupervisor({ components: [worker.component] });
  const first = issue(supervisor, 'START', 1);
  const repeat = issue(supervisor, 'START', 1, T0 + 1);
  const concurrent = issue(supervisor, 'START', 2, T0 + 1);
  check('pending command exposes active correlation', first.ok && supervisor.snapshot().commandCorrelationId === first.value.correlationId);
  check('same revision/verb returns same receipt', repeat.ok && first.ok && repeat.value.commandId === first.value.commandId);
  check('new concurrent revision rejected', !concurrent.ok && concurrent.failure.code === CONTROL_FAILURE_CODES.COMMAND_IN_PROGRESS);
  check('rejected concurrent command does not consume revision', supervisor.snapshot().revision === 1);
  supervisor.tick(T0 + 2);
  check('explicit tick completes pending start', supervisor.snapshot().phase === 'RUNNING' && worker.state.startCalls === 2);
}

// =====================================================================
section('5. partial startup rolls back only components actually started');
{
  const log = [];
  const a = managed('a', { log });
  const b = managed('b', {
    log,
    dependsOn: ['a'],
    start: (ctx) => ({ kind: 'FAILED', failure: portFailure('b', 'start', 'B_START_FAILED', ctx) }),
  });
  const c = managed('c', { log, dependsOn: ['b'] });
  const supervisor = makeSupervisor({ components: [c.component, b.component, a.component] });
  issue(supervisor, 'START', 1);
  check('failed child is exact failure source', supervisor.snapshot().lastError?.component === 'b' && supervisor.snapshot().lastError?.stage === 'start');
  check('only started predecessor rolled back', log.filter((entry) => entry.startsWith('stop')).join('|') === 'stop:a', log.join('|'));
  check('later component never started', c.state.startCalls === 0 && c.state.stopCalls === 0);
  check('rollback ends FAILED with no hidden started component', supervisor.snapshot().phase === 'FAILED' && supervisor.startedComponents().length === 0);
}

// =====================================================================
section('6. timeout is distinct from thrown adapter failure');
{
  const pending = managed('pending', { start: () => ({ kind: 'PENDING' }), stepTimeoutMs: 5 });
  const timed = makeSupervisor({ components: [pending.component] });
  issue(timed, 'START', 1);
  timed.tick(T0 + 5);
  check('component timeout has timeout code', timed.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_START_TIMEOUT);
  check('timeout retains exact component/stage', timed.snapshot().lastError?.component === 'pending' && timed.snapshot().lastError?.stage === 'start');

  const throwing = managed('throwing', { validate: () => { throw new Error('not surfaced'); } });
  const threw = makeSupervisor({ components: [throwing.component] });
  issue(threw, 'START', 1);
  check('throw has separate typed code', threw.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_VALIDATE_THREW);
  check('arbitrary thrown text is not leaked', !threw.snapshot().lastError?.message.includes('not surfaced'));

  const gatePending = managed('gate-worker');
  const gateTimed = makeSupervisor({
    components: [gatePending.component],
    gateTimeoutMs: 4,
    gates: [{ gate: 'remoteReadiness', blocking: true, run: () => ({ status: 'PENDING' }) }],
  });
  issue(gateTimed, 'START', 1);
  gateTimed.tick(T0 + 4);
  check('per-gate timeout blocks at exact gate', gateTimed.snapshot().phase === 'BLOCKED' && gateTimed.snapshot().blockedAtGate === 'remoteReadiness');
  check('gate timeout has typed code/status', gateTimed.snapshot().lastError?.code === CONTROL_FAILURE_CODES.PREFLIGHT_GATE_TIMEOUT && gateTimed.snapshot().preflight.find((gate) => gate.gate === 'remoteReadiness')?.status === 'TIMEOUT');
}

// =====================================================================
section('7. stale source degrades; fatal required child fails');
{
  let stale = false;
  const source = managed('source', {
    probe: (ctx) => ({
      heartbeatAt: ctx.nowMs,
      timestamp: timestamp(stale ? T0 : ctx.nowMs, 5),
      fatal: null,
    }),
  });
  const supervisor = makeSupervisor({ components: [source.component] });
  issue(supervisor, 'START', 1);
  check('fresh source starts RUNNING', supervisor.snapshot().phase === 'RUNNING');
  stale = true;
  supervisor.tick(T0 + 10);
  const degraded = supervisor.snapshot();
  check('stale source becomes DEGRADED', degraded.phase === 'DEGRADED');
  check('stale authority is downgraded to UNAVAILABLE', degraded.components[0].authority === 'UNAVAILABLE');
  check('stale failure is explicit', degraded.lastError?.code === CONTROL_FAILURE_CODES.REQUIRED_SOURCE_STALE);
  check('degraded failure names terminal safe state', degraded.lastError?.safeCurrentState === 'DEGRADED');

  let fatal = false;
  const required = managed('required', {
    probe: (ctx) => ({
      heartbeatAt: ctx.nowMs,
      timestamp: timestamp(ctx.nowMs),
      fatal: fatal ? portFailure('required', 'probe', 'CHILD_FATAL', ctx) : null,
    }),
  });
  const fatalSupervisor = makeSupervisor({ components: [required.component] });
  issue(fatalSupervisor, 'START', 1);
  fatal = true;
  fatalSupervisor.tick(T0 + 1);
  check('fatal required child makes runtime FAILED', fatalSupervisor.snapshot().phase === 'FAILED');
  check('fatal evidence remains exact', fatalSupervisor.snapshot().lastError?.code === 'CHILD_FATAL');
}

// =====================================================================
section('8. double stop is idempotent');
{
  const worker = managed('worker');
  const supervisor = makeSupervisor({ components: [worker.component] });
  issue(supervisor, 'START', 1);
  const firstStop = issue(supervisor, 'STOP', 2, T0 + 1);
  const secondStop = issue(supervisor, 'STOP', 3, T0 + 2);
  check('first stop applied', firstStop.ok && firstStop.value.applied);
  check('second stop is no-op', secondStop.ok && !secondStop.value.applied);
  check('stop port called once', worker.state.stopCalls === 1);
}

// =====================================================================
section('9. restart advances generation and retains prior failure evidence');
{
  let stale = false;
  const worker = managed('worker', {
    probe: (ctx) => ({
      heartbeatAt: ctx.nowMs,
      timestamp: timestamp(stale ? T0 : ctx.nowMs, 5),
      fatal: null,
    }),
  });
  const supervisor = makeSupervisor({ components: [worker.component] });
  issue(supervisor, 'START', 1);
  stale = true;
  supervisor.tick(T0 + 10);
  const evidenceCount = supervisor.failureHistory().length;
  stale = false;
  issue(supervisor, 'RESTART', 2, T0 + 11);
  check('restart reaches fresh RUNNING', supervisor.snapshot().phase === 'RUNNING');
  check('restart increments generation', supervisor.snapshot().generation === 2);
  check('restart performed stop then second start', worker.state.stopCalls === 1 && worker.state.startCalls === 2);
  check('previous failure history retained', evidenceCount > 0 && supervisor.failureHistory().length >= evidenceCount);
  check('last failure evidence is not erased by success', supervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.REQUIRED_SOURCE_STALE);
}

// =====================================================================
section('10. stale and reused command revisions fail deterministically');
{
  const worker = managed('worker');
  const supervisor = makeSupervisor({ components: [worker.component] });
  issue(supervisor, 'START', 5);
  const stale = issue(supervisor, 'STOP', 4, T0 + 1);
  const reused = issue(supervisor, 'STOP', 5, T0 + 1);
  check('lower revision rejected stale', !stale.ok && stale.failure.code === CONTROL_FAILURE_CODES.STALE_COMMAND_REVISION);
  check('same revision with different intent rejected', !reused.ok && reused.failure.code === CONTROL_FAILURE_CODES.COMMAND_REVISION_REUSED);
  check('rejections do not change running state', supervisor.snapshot().phase === 'RUNNING' && supervisor.snapshot().revision === 5);
}

// =====================================================================
section('11. keyless intelligence and missing borrow truth exclude only dependants');
{
  const publicFeed = managed('publicFeed');
  const privateAccount = managed('privateAccount', { requiresPrivateKeys: true });
  const executionView = managed('executionView', { dependsOn: ['privateAccount'] });
  const supervisor = makeSupervisor({
    components: [executionView.component, privateAccount.component, publicFeed.component],
    environment: { privateKeysAvailable: false, killSwitchEngaged: false, borrowTruthPresent: true },
  });
  issue(supervisor, 'START', 1);
  check('keyless INTELLIGENCE remains usable', supervisor.snapshot().phase === 'RUNNING');
  check('only public component starts', supervisor.startedComponents().join('|') === 'publicFeed', supervisor.startedComponents().join('|'));
  check('private component and dependant explicitly excluded', supervisor.excludedComponents().has('privateAccount') && supervisor.excludedComponents().has('executionView'));

  const market = managed('market');
  const borrowAction = managed('borrowAction', { dependsOn: ['market'], requiresBorrowTruth: true });
  const unrelated = managed('unrelated', { dependsOn: ['market'] });
  const borrowSupervisor = makeSupervisor({
    components: [borrowAction.component, unrelated.component, market.component],
    environment: { privateKeysAvailable: true, killSwitchEngaged: false, borrowTruthPresent: false },
  });
  issue(borrowSupervisor, 'START', 1);
  check('missing borrow truth does not poison unrelated intelligence', borrowSupervisor.snapshot().phase === 'RUNNING' && borrowSupervisor.startedComponents().includes('unrelated'));
  check('borrow-dependent action alone is excluded', !borrowSupervisor.startedComponents().includes('borrowAction') && borrowSupervisor.excludedComponents().has('borrowAction'));
}

// =====================================================================
section('12. kill switch blocks only risk-increasing startup');
{
  const risky = managed('risky', { riskIncreasing: true });
  const blocked = makeSupervisor({
    components: [risky.component],
    environment: { privateKeysAvailable: true, killSwitchEngaged: true, borrowTruthPresent: true },
  });
  issue(blocked, 'START', 1);
  check('kill switch blocks risky runtime', blocked.snapshot().phase === 'BLOCKED' && blocked.snapshot().blockedAtGate === 'killSwitch');
  check('kill-switch failure code explicit', blocked.snapshot().lastError?.code === CONTROL_FAILURE_CODES.KILL_SWITCH_ENGAGED);
  check('risk-increasing component never starts', risky.state.startCalls === 0);

  const readonly = managed('readonly');
  const permitted = makeSupervisor({
    components: [readonly.component],
    environment: { privateKeysAvailable: false, killSwitchEngaged: true, borrowTruthPresent: true },
  });
  issue(permitted, 'START', 1);
  check('kill switch does not block read-only intelligence', permitted.snapshot().phase === 'RUNNING');
}

// =====================================================================
section('13. EXECUTION_LIVE remains explicitly blocked');
{
  const worker = managed('worker');
  const supervisor = makeSupervisor({ components: [worker.component], runMode: 'EXECUTION_LIVE' });
  issue(supervisor, 'START', 1);
  const snapshot = supervisor.snapshot();
  check('live mode blocked at runMode gate', snapshot.phase === 'BLOCKED' && snapshot.blockedAtGate === 'runMode');
  check('exact frozen live-block code returned', snapshot.lastError?.code === LIVE_EXECUTION_BLOCK_CODE);
  check('all later gates skipped', snapshot.preflight.filter((gate) => gate.gate !== 'runMode').every((gate) => gate.status === 'SKIPPED'));
  check('no component reached validation/start', worker.state.validateCalls === 0 && worker.state.startCalls === 0);
}

// =====================================================================
section('14. failures name terminal safe state; STOP clears blocked gate');
{
  const risky = managed('risky', { riskIncreasing: true });
  const supervisor = makeSupervisor({
    components: [risky.component],
    environment: { privateKeysAvailable: true, killSwitchEngaged: true, borrowTruthPresent: true },
  });
  issue(supervisor, 'START', 1);
  check('blocking failure safe state matches BLOCKED snapshot', supervisor.snapshot().phase === 'BLOCKED' && supervisor.snapshot().lastError?.safeCurrentState === 'BLOCKED');
  issue(supervisor, 'STOP', 2, T0 + 1);
  check('blocked runtime can stop cleanly', supervisor.snapshot().phase === 'STOPPED');
  check('STOP clears stale blockedAtGate', supervisor.snapshot().blockedAtGate === null);
}

// =====================================================================
section('15. zero eligible components blocks instead of fabricating RUNNING');
{
  const privateOnly = managed('privateOnly', { requiresPrivateKeys: true });
  const supervisor = makeSupervisor({
    components: [privateOnly.component],
    environment: { privateKeysAvailable: false, killSwitchEngaged: false, borrowTruthPresent: true },
  });
  issue(supervisor, 'START', 1);
  const snapshot = supervisor.snapshot();
  check('empty eligible set is BLOCKED', snapshot.phase === 'BLOCKED' && snapshot.blockedAtGate === 'componentEligibility');
  check('empty eligibility has explicit code', snapshot.lastError?.code === CONTROL_FAILURE_CODES.NO_ELIGIBLE_COMPONENTS);
  check('no fake started timestamp/heartbeat', snapshot.startedAt === null && snapshot.heartbeatAt === null);
  check('no component actually started', supervisor.startedComponents().length === 0 && privateOnly.state.startCalls === 0);
  check('failure safe state is BLOCKED', snapshot.lastError?.safeCurrentState === snapshot.phase);
}

// =====================================================================
section('16. borrow truth loss degrades only affected running components');
{
  const environment = { privateKeysAvailable: true, killSwitchEngaged: false, borrowTruthPresent: true };
  const publicFeed = managed('publicFeed');
  const borrowAction = managed('borrowAction', { dependsOn: ['publicFeed'], requiresBorrowTruth: true });
  const supervisor = makeSupervisor({ components: [borrowAction.component, publicFeed.component], environment });
  issue(supervisor, 'START', 1);
  check('setup starts both components', supervisor.snapshot().phase === 'RUNNING' && supervisor.startedComponents().length === 2);
  environment.borrowTruthPresent = false;
  supervisor.tick(T0 + 1);
  const degraded = supervisor.snapshot();
  const publicStatus = degraded.components.find((component) => component.name === 'publicFeed');
  const borrowStatus = degraded.components.find((component) => component.name === 'borrowAction');
  check('runtime degrades on post-start borrow loss', degraded.phase === 'DEGRADED' && degraded.desiredState === 'RUNNING');
  check('borrow component is stopped and blocked', borrowStatus?.phase === 'BLOCKED' && borrowStatus.authority === 'UNAVAILABLE' && borrowAction.state.stopCalls === 1);
  check('unrelated public component remains healthy', publicStatus?.phase === 'RUNNING');
  check('dynamic exclusion and actual stop are explicit', supervisor.excludedComponents().has('borrowAction') && !supervisor.startedComponents().includes('borrowAction') && degraded.lastError?.code === CONTROL_FAILURE_CODES.BORROW_TRUTH_UNAVAILABLE);
  check('borrow-loss failure matches terminal safe state', degraded.lastError?.safeCurrentState === 'DEGRADED');
  environment.borrowTruthPresent = true;
  supervisor.tick(T0 + 2);
  check('truth recovery alone cannot silently restart action', supervisor.snapshot().phase === 'DEGRADED' && !supervisor.startedComponents().includes('borrowAction'));
  issue(supervisor, 'RESTART', 2, T0 + 3);
  check('operator restart after recovery restores health', supervisor.snapshot().phase === 'RUNNING' && supervisor.startedComponents().includes('borrowAction'));
}

// =====================================================================
section('17. blocking borrow gate is scoped to borrow actions');
{
  let laterCalls = 0;
  const publicFeed = managed('publicFeed');
  const borrowAction = managed('borrowAction', { dependsOn: ['publicFeed'], requiresBorrowTruth: true });
  const supervisor = makeSupervisor({
    components: [borrowAction.component, publicFeed.component],
    gates: [
      { gate: 'borrowCapacity', blocking: true, borrowDependent: true, run: () => ({ status: 'FAIL', detail: 'capacity unavailable' }) },
      { gate: 'laterPublicGate', blocking: true, run: () => { laterCalls += 1; return { status: 'PASS' }; } },
    ],
  });
  issue(supervisor, 'START', 1);
  const snapshot = supervisor.snapshot();
  const borrowGate = snapshot.preflight.find((gate) => gate.gate === 'borrowCapacity');
  check('public runtime still reaches RUNNING', snapshot.phase === 'RUNNING' && supervisor.startedComponents().includes('publicFeed'));
  check('borrow action is excluded and never started', supervisor.excludedComponents().has('borrowAction') && borrowAction.state.startCalls === 0);
  check('borrow failure is recorded as scoped/non-global', borrowGate?.status === 'FAIL' && borrowGate.blocking === false);
  check('later public gate still executes', laterCalls === 1);
}

// =====================================================================
section('18. rollback-stop failure remains final evidence with active component');
{
  const a = managed('a', {
    stop: (ctx) => ({ kind: 'FAILED', failure: portFailure('a', 'stop', 'A_ROLLBACK_STOP_FAILED', ctx) }),
  });
  const b = managed('b', {
    dependsOn: ['a'],
    start: (ctx) => ({ kind: 'FAILED', failure: portFailure('b', 'start', 'B_START_FAILED', ctx) }),
  });
  const supervisor = makeSupervisor({ components: [b.component, a.component] });
  issue(supervisor, 'START', 1);
  const snapshot = supervisor.snapshot();
  const aStatus = snapshot.components.find((component) => component.name === 'a');
  check('rollback failure ends FAILED', snapshot.phase === 'FAILED');
  check('rollback failure, not primary failure, is lastError', snapshot.lastError?.code === 'A_ROLLBACK_STOP_FAILED' && snapshot.lastError.component === 'a' && snapshot.lastError.stage === 'stop');
  check('unsafe active component remains explicitly visible', supervisor.startedComponents().includes('a') && aStatus?.phase === 'FAILED' && snapshot.startedAt !== null);
  check('rollback failure safe state matches snapshot', snapshot.lastError?.safeCurrentState === 'FAILED');
  check('primary and rollback evidence both retained', supervisor.failureHistory().some((entry) => entry.failure.code === 'B_START_FAILED') && supervisor.failureHistory().some((entry) => entry.failure.code === 'A_ROLLBACK_STOP_FAILED'));
}

// =====================================================================
section('19. malformed adapters and regressing clocks fail deterministically');
{
  const worker = managed('worker');
  const blankGate = makeSupervisor({
    components: [worker.component],
    gates: [{ gate: 'blankFailure', blocking: true, run: () => ({ status: 'FAIL', detail: '' }) }],
  });
  let blankThrew = false;
  try { issue(blankGate, 'START', 1); } catch { blankThrew = true; }
  check('blank FAIL detail becomes contract failure, not throw', !blankThrew && blankGate.snapshot().phase === 'BLOCKED');
  check('blank FAIL detail has typed contract code', blankGate.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

  let longNameRejected = false;
  try {
    const tooLong = managed('x'.repeat(201));
    makeSupervisor({ components: [tooLong.component] });
  } catch (error) {
    longNameRejected = error instanceof TypeError;
  }
  check('overlong component name rejected at construction', longNameRejected);

  const monotonic = makeSupervisor({ components: [managed('clocked').component] });
  issue(monotonic, 'START', 1, T0);
  let regressionRejected = false;
  try { monotonic.tick(T0 - 1); } catch (error) { regressionRejected = error instanceof TypeError; }
  check('backward injected time rejected', regressionRejected);
  check('recorded transitions remain monotonic', monotonic.transitionHistory().every((entry, index, all) => index === 0 || entry.atMs >= all[index - 1].atMs));

  const rejectedClock = makeSupervisor({ components: [managed('rejectedClock').component] });
  issue(rejectedClock, 'START', 1, T0);
  const staleFuture = issue(rejectedClock, 'STOP', 0, T0 + 1_000_000);
  let poisonedByRejected = false;
  try { rejectedClock.tick(T0 + 1); } catch { poisonedByRejected = true; }
  check('rejected far-future command does not advance clock watermark', !staleFuture.ok && !poisonedByRejected);

  const noopFuture = issue(rejectedClock, 'START', 2, T0 + 2_000_000);
  let poisonedByNoop = false;
  try { rejectedClock.tick(T0 + 2); } catch { poisonedByNoop = true; }
  check('idempotent no-op does not poison clock watermark', noopFuture.ok && !noopFuture.value.applied && !poisonedByNoop);
}

// =====================================================================
section('20. environment-provider loss stays explicit and fails closed');
{
  let unavailable = false;
  let publicProbePrivateKeyFact = true;
  let safetyStopPrivateKeyFact = true;
  const environment = () => {
    if (unavailable) throw new Error('provider offline');
    return { privateKeysAvailable: true, killSwitchEngaged: false, borrowTruthPresent: true };
  };
  const publicFeed = managed('publicFeed', {
    probe: (ctx) => {
      publicProbePrivateKeyFact = ctx.privateKeysAvailable;
      return { heartbeatAt: ctx.nowMs, timestamp: timestamp(ctx.nowMs), fatal: null };
    },
  });
  const safetyAction = managed('safetyAction', {
    dependsOn: ['publicFeed'],
    requiresBorrowTruth: true,
    riskIncreasing: true,
    stop: (ctx) => {
      safetyStopPrivateKeyFact = ctx.privateKeysAvailable;
      return { kind: 'COMPLETE' };
    },
  });
  const supervisor = makeSupervisor({ components: [safetyAction.component, publicFeed.component], environment });
  issue(supervisor, 'START', 1);
  unavailable = true;
  supervisor.tick(T0 + 1);
  const snapshot = supervisor.snapshot();
  check('provider loss degrades runtime without throwing', snapshot.phase === 'DEGRADED');
  check('safety-dependent component is actually stopped', safetyAction.state.stopCalls === 1 && !supervisor.startedComponents().includes('safetyAction'));
  check('provider loss is not misreported as borrow or kill-switch fact', snapshot.lastError?.code === CONTROL_FAILURE_CODES.ENVIRONMENT_UNAVAILABLE);
  check('unavailable private-key fact is passed as null', publicProbePrivateKeyFact === null && safetyStopPrivateKeyFact === null);
  check('public component remains running under explicit degraded posture', snapshot.components.find((component) => component.name === 'publicFeed')?.phase === 'RUNNING');
}

// =====================================================================
section('21. persistent probe defects coalesce into bounded first/last evidence');
{
  const throwing = managed('throwingProbe', {
    required: false,
    probe: () => { throw new Error('hidden repeated probe defect'); },
  });
  const malformed = managed('malformedProbe', {
    required: false,
    probe: () => ({ heartbeatAt: 'not-a-timestamp', timestamp: null, fatal: null }),
  });
  const supervisor = makeSupervisor({ components: [throwing.component, malformed.component] });
  issue(supervisor, 'START', 1);
  const tickCount = FAILURE_HISTORY_CAPACITY * 4;
  for (let index = 1; index <= tickCount; index += 1) supervisor.tick(T0 + index);
  const occurrenceCount = tickCount + 1; // START performs the first admitted health pass at T0.

  const history = supervisor.failureHistory();
  const thrownEntries = history.filter((entry) => entry.failure.code === CONTROL_FAILURE_CODES.COMPONENT_PROBE_THREW);
  const invalidEntries = history.filter((entry) => entry.failure.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);
  const thrown = thrownEntries.find((entry) => entry.occurrenceCount === tickCount);
  const invalid = invalidEntries.find((entry) => entry.occurrenceCount === tickCount);
  const retention = supervisor.historyRetention();
  check('failures coalesce within exact command and health correlations', history.length === 4
    && thrownEntries.some((entry) => entry.occurrenceCount === 1)
    && invalidEntries.some((entry) => entry.occurrenceCount === 1), String(history.length));
  check('throwing probe count and exact first/last evidence are retained', thrown?.occurrenceCount === tickCount
    && thrown.firstFailure?.occurredAt === T0 + 1
    && thrown.lastFailure?.occurredAt === T0 + tickCount
    && thrown.failure === thrown.lastFailure);
  check('malformed probe count and exact first/last evidence are retained', invalid?.occurrenceCount === tickCount
    && invalid.firstFailure?.occurredAt === T0 + 1
    && invalid.lastFailure?.occurredAt === T0 + tickCount
    && invalid.failure === invalid.lastFailure);
  check('coalescing reports exact retained occurrences without false eviction', retention?.failureCapacity === FAILURE_HISTORY_CAPACITY
    && retention.totalFailureOccurrences === occurrenceCount * 2
    && retention.retainedFailureOccurrences === occurrenceCount * 2
    && retention.evictedFailureRecords === 0
    && retention.evictedFailureOccurrences === 0);
  check('latest supervisor failure remains current rather than frozen at first occurrence', supervisor.snapshot().lastError?.occurredAt === T0 + tickCount);
}

// =====================================================================
section('22. unique failures and phase flapping retain bounded honest history');
{
  let uniqueIndex = 0;
  const unique = managed('uniqueProbe', {
    required: false,
    probe: (ctx) => {
      uniqueIndex += 1;
      return {
        heartbeatAt: ctx.nowMs,
        timestamp: timestamp(ctx.nowMs),
        fatal: portFailure('uniqueProbe', 'probe', `UNIQUE_PROBE_${uniqueIndex}`, ctx),
      };
    },
  });
  const uniqueSupervisor = makeSupervisor({ components: [unique.component] });
  issue(uniqueSupervisor, 'START', 1);
  const uniqueTickCount = FAILURE_HISTORY_CAPACITY + 7;
  for (let index = 1; index <= uniqueTickCount; index += 1) uniqueSupervisor.tick(T0 + index);
  const uniqueOccurrenceCount = uniqueTickCount + 1;
  const uniqueRetention = uniqueSupervisor.historyRetention();
  check('unique failure aggregates never exceed the fixed capacity', uniqueSupervisor.failureHistory().length === FAILURE_HISTORY_CAPACITY);
  check('failure eviction is counted exactly instead of hidden', uniqueRetention?.totalFailureOccurrences === uniqueOccurrenceCount
    && uniqueRetention.retainedFailureOccurrences === FAILURE_HISTORY_CAPACITY
    && uniqueRetention.evictedFailureRecords === uniqueOccurrenceCount - FAILURE_HISTORY_CAPACITY
    && uniqueRetention.evictedFailureOccurrences === uniqueOccurrenceCount - FAILURE_HISTORY_CAPACITY);
  check('newest failure survives bounded eviction', uniqueSupervisor.snapshot().lastError?.code === `UNIQUE_PROBE_${uniqueIndex}`
    && uniqueSupervisor.failureHistory().at(-1)?.failure.code === `UNIQUE_PROBE_${uniqueIndex}`);

  let throwNext = true;
  const flapping = managed('flappingProbe', {
    required: false,
    probe: (ctx) => {
      if (throwNext) {
        throwNext = false;
        throw new Error('hidden flapping defect');
      }
      throwNext = true;
      return { heartbeatAt: ctx.nowMs, timestamp: timestamp(ctx.nowMs), fatal: null };
    },
  });
  const transitionSupervisor = makeSupervisor({ components: [flapping.component] });
  issue(transitionSupervisor, 'START', 1);
  const transitionsBefore = transitionSupervisor.historyRetention().totalTransitionRecords;
  const flapCount = TRANSITION_HISTORY_CAPACITY * 2;
  for (let index = 1; index <= flapCount; index += 1) transitionSupervisor.tick(T0 + index);
  const transitions = transitionSupervisor.transitionHistory();
  const transitionRetention = transitionSupervisor.historyRetention();
  const lastTransition = transitions.at(-1);
  const indexedTargets = lastTransition?.correlationId === null
    ? []
    : transitionSupervisor.transitionTargetsForCorrelation(lastTransition.correlationId);
  check('phase-transition history is capped and chronological', transitions.length === TRANSITION_HISTORY_CAPACITY
    && transitions.every((entry, index, all) => index === 0 || entry.atMs >= all[index - 1].atMs));
  check('transition retention accounts for every overwritten record', transitionRetention?.transitionCapacity === TRANSITION_HISTORY_CAPACITY
    && transitionRetention.totalTransitionRecords === transitionsBefore + flapCount
    && transitionRetention.retainedTransitionRecords === TRANSITION_HISTORY_CAPACITY
    && transitionRetention.evictedTransitionRecords === transitionsBefore + flapCount - TRANSITION_HISTORY_CAPACITY);
  check('bounded correlation index retains the newest transition destination', lastTransition !== undefined
    && indexedTargets.includes(lastTransition.to));
}

// =====================================================================
section('23. synchronous ports reject thenables without ambient rejection escape');
{
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const environmentWorker = managed('environmentThenable');
    const environmentSupervisor = makeSupervisor({
      components: [environmentWorker.component],
      environment: () => Object.assign(
        Promise.reject(new Error('hidden environment rejection')),
        { privateKeysAvailable: true, killSwitchEngaged: false, borrowTruthPresent: true },
      ),
    });
    issue(environmentSupervisor, 'START', 1);
    check('decorated rejected environment Promise cannot pass valid-looking fields', environmentSupervisor.snapshot().phase === 'FAILED'
      && environmentSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.ENVIRONMENT_INVALID);

    const gateWorker = managed('gateThenable');
    const gateSupervisor = makeSupervisor({
      components: [gateWorker.component],
      gates: [{
        gate: 'thenableGate',
        blocking: true,
        run: () => Object.assign(Promise.reject(new Error('hidden gate rejection')), { status: 'PASS', detail: 'decorated pass' }),
      }],
    });
    issue(gateSupervisor, 'START', 1);
    check('decorated rejected gate Promise cannot pass valid-looking fields', gateSupervisor.snapshot().phase === 'BLOCKED'
      && gateSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    const lifecycleWorker = managed('lifecycleThenable', {
      validate: () => Object.assign(
        new Promise((_resolve, reject) => queueMicrotask(() => reject(new Error('delayed lifecycle rejection')))),
        { kind: 'COMPLETE', detail: 'decorated complete' },
      ),
    });
    const lifecycleSupervisor = makeSupervisor({ components: [lifecycleWorker.component] });
    issue(lifecycleSupervisor, 'START', 1);
    check('decorated delayed lifecycle Promise cannot pass valid-looking fields', lifecycleSupervisor.snapshot().phase === 'FAILED'
      && lifecycleSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    const probeWorker = managed('probeThenable', {
      probe: () => Object.assign(
        new Promise((_resolve, reject) => queueMicrotask(() => reject(new Error('delayed probe rejection')))),
        { heartbeatAt: T0, timestamp: timestamp(T0), fatal: null },
      ),
    });
    const probeSupervisor = makeSupervisor({ components: [probeWorker.component] });
    issue(probeSupervisor, 'START', 1);
    check('decorated delayed probe Promise cannot pass valid-looking fields', probeSupervisor.snapshot().phase === 'FAILED'
      && probeSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    let thenGetterReads = 0;
    let thenCalls = 0;
    const multiCallbackThenable = { status: 'PASS', detail: 'decorated hostile pass' };
    Object.defineProperty(multiCallbackThenable, 'then', {
      get() {
        thenGetterReads += 1;
        return (resolve, reject) => {
          thenCalls += 1;
          reject(new Error('first hostile callback'));
          resolve('later hostile resolution');
          reject(new Error('second hostile callback'));
          throw new Error('hostile then invocation');
        };
      },
    });
    const multiWorker = managed('multiCallbackThenable');
    const multiSupervisor = makeSupervisor({
      components: [multiWorker.component],
      gates: [{ gate: 'multiCallbackThenable', blocking: true, run: () => multiCallbackThenable }],
    });
    issue(multiSupervisor, 'START', 1);
    check('callable then is read and invoked exactly once despite multiple callbacks and throw', thenGetterReads === 1 && thenCalls === 1);
    check('decorated custom thenable is malformed before gate shape validation', multiSupervisor.snapshot().phase === 'BLOCKED'
      && multiSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    let throwingGetterReads = 0;
    const throwingGetterEnvironment = { privateKeysAvailable: true, killSwitchEngaged: false, borrowTruthPresent: true };
    Object.defineProperty(throwingGetterEnvironment, 'then', {
      get() {
        throwingGetterReads += 1;
        throw new Error('hostile then getter');
      },
    });
    const throwingGetterWorker = managed('throwingGetterThenable');
    const throwingGetterSupervisor = makeSupervisor({
      components: [throwingGetterWorker.component],
      environment: () => throwingGetterEnvironment,
    });
    issue(throwingGetterSupervisor, 'START', 1);
    check('throwing then getter is read once and classified as malformed environment', throwingGetterReads === 1
      && throwingGetterSupervisor.snapshot().phase === 'FAILED'
      && throwingGetterSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.ENVIRONMENT_INVALID);

    let proxyThenReads = 0;
    const hostileProxy = new Proxy({ status: 'PASS', detail: 'decorated proxy pass' }, {
      get(target, property, receiver) {
        if (property === 'then') {
          proxyThenReads += 1;
          throw new Error('hostile proxy then trap');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const proxyWorker = managed('proxyThenable');
    const proxySupervisor = makeSupervisor({
      components: [proxyWorker.component],
      gates: [{ gate: 'proxyThenable', blocking: true, run: () => hostileProxy }],
    });
    issue(proxySupervisor, 'START', 1);
    check('throwing Proxy then trap is read once and cannot reach shape validation', proxyThenReads === 1
      && proxySupervisor.snapshot().phase === 'BLOCKED'
      && proxySupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    let asyncThenCalls = 0;
    const asyncThenable = {
      status: 'PASS',
      detail: 'decorated async pass',
      async then() {
        asyncThenCalls += 1;
        throw new Error('async then return rejection');
      },
    };
    const asyncWorker = managed('asyncThenable');
    const asyncSupervisor = makeSupervisor({
      components: [asyncWorker.component],
      gates: [{ gate: 'asyncThenable', blocking: true, run: () => asyncThenable }],
    });
    issue(asyncSupervisor, 'START', 1);
    check('rejected async then return is observed and remains a typed malformed gate', asyncThenCalls === 1
      && asyncSupervisor.snapshot().phase === 'BLOCKED'
      && asyncSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    let cyclicThenCalls = 0;
    const cyclicA = { status: 'PASS', detail: 'decorated cyclic pass' };
    const cyclicB = {};
    cyclicA.then = () => {
      cyclicThenCalls += 1;
      return cyclicB;
    };
    cyclicB.then = () => {
      cyclicThenCalls += 1;
      return cyclicA;
    };
    const cyclicWorker = managed('cyclicThenable');
    const cyclicSupervisor = makeSupervisor({
      components: [cyclicWorker.component],
      gates: [{ gate: 'cyclicThenable', blocking: true, run: () => cyclicA }],
    });
    issue(cyclicSupervisor, 'START', 1);
    check('cyclic returned thenables are bounded and each invoked once', cyclicThenCalls === 2
      && cyclicSupervisor.snapshot().phase === 'BLOCKED'
      && cyclicSupervisor.snapshot().lastError?.code === CONTROL_FAILURE_CODES.COMPONENT_CONTRACT_VIOLATION);

    await flushRejectedTurn();
    check('same-turn observers prevent every hostile port rejection from becoming unhandled', unhandled.length === 0, `${unhandled.length} unhandled`);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} control: ${passed}/${results.length}`);
if (failed > 0) process.exit(1);
