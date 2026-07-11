#!/usr/bin/env node
/**
 * Lane A — deterministic control-plane proof. ZERO network, ZERO wall clock.
 * Run after `npm run build -w server`:
 *   node server/test/foundation/control/control.mjs
 */
import {
  CONTROL_FAILURE_CODES,
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

const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} control: ${passed}/${results.length}`);
if (failed > 0) process.exit(1);
