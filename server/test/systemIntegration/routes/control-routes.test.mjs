import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { OperatorAccess } from '../../../dist/security/access.js';
import { SystemControlService } from '../../../dist/systemIntegration/controls/index.js';
import { createSystemIntegrationRouter } from '../../../dist/systemIntegration/routes/index.js';

const HOST = '127.0.0.1';
const T0 = 1_800_000_000_000;
const OPS_READBACK = Object.freeze({
  source: 'CANONICAL_SUPERVISOR_READBACK',
  observedAtUtc: new Date(T0).toISOString().replace('.000Z', 'Z'),
  validUntilUtc: new Date(T0 + 10 * 60_000).toISOString().replace('.000Z', 'Z'),
  deploymentFrozen: false,
  exposureState: 'NONE',
  ambiguityState: 'NONE',
  recoveryState: 'NONE',
  currentSchemaVersion: 1,
  rollbackFloor: 1,
});

class Persistence {
  constructor(state) {
    this.state = state;
    this.records = new Map();
    this.rejectionRecords = new Map();
    this.rejections = [];
    this.commits = [];
    this.nextId = 1;
  }
  async findControlMutation(key) { return this.records.get(key) ?? null; }
  async recordControlRejection(audit) {
    const prior = this.rejectionRecords.get(audit.dedupeKey);
    if (prior !== undefined) return { kind: 'IDEMPOTENT_REPLAY', ledgerEventId: prior };
    const ledgerEventId = this.nextId++;
    this.rejectionRecords.set(audit.dedupeKey, ledgerEventId);
    this.rejections.push(audit);
    return { kind: 'RECORDED', ledgerEventId };
  }
  async commitControlMutation(commit) {
    const prior = this.records.get(commit.request.idempotencyKey);
    if (prior) return prior.requestDigest === commit.requestDigest
      ? { kind: 'IDEMPOTENT_REPLAY', ...prior }
      : { kind: 'IDEMPOTENCY_CONFLICT', requestDigest: prior.requestDigest };
    if (commit.request.expectedRevision !== this.state.revision) {
      return { kind: 'REVISION_CONFLICT', current: this.state };
    }
    const receipt = Object.freeze({
      applied: commit.applied,
      code: commit.code,
      before: commit.before,
      after: commit.after,
      ledgerEventId: this.nextId++,
    });
    const runtimePublication = commit.applied
      && ['RESTART_COMPONENT', 'SET_COMPONENT_STATE'].includes(commit.request.mutation.command)
      ? 'PENDING'
      : 'NOT_REQUIRED';
    this.state = receipt.after;
    this.commits.push(commit);
    this.records.set(commit.request.idempotencyKey, {
      requestDigest: commit.requestDigest,
      receipt,
      runtimePublication,
    });
    return { kind: 'COMMITTED', receipt, runtimePublication };
  }
  async markControlRuntimePublished(commit) {
    const prior = this.records.get(commit.idempotencyKey);
    if (!prior || prior.requestDigest !== commit.requestDigest) throw new Error('publication identity mismatch');
    if (prior.runtimePublication === 'PUBLISHED') return { kind: 'IDEMPOTENT_REPLAY' };
    prior.runtimePublication = 'PUBLISHED';
    return { kind: 'PUBLISHED' };
  }
}

class Composition {
  constructor() { this.inspected = []; this.published = []; this.effects = new Map(); }
  async inspectMutation(mutation) {
    this.inspected.push(mutation);
    return { ok: true, applied: true, riskIncreasing: false, code: 'CONTROL_APPLIED', message: '' };
  }
  async publishCommitted(request, actor, receipt) {
    this.published.push({ request, actor, receipt });
    if (['RESTART_COMPONENT', 'SET_COMPONENT_STATE'].includes(request.mutation.command)) {
      this.effects.set(`${request.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`, 'APPLIED');
    }
  }
  inspectCommittedPublication(request, receipt) {
    return this.effects.get(
      `${request.idempotencyKey}:${receipt.after.revision}:${receipt.after.generation}`,
    ) ?? 'UNKNOWN';
  }
}

function baseState() {
  return Object.freeze({
    revision: 0,
    generation: 1,
    safeMode: 'READ_ONLY',
    killSwitchEngaged: false,
    intakePaused: false,
    updatedAtMs: T0,
    correlationId: 'cor_route_initial',
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
  return `http://${HOST}:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function json(response) {
  return response.json().catch(() => null);
}

test('system integration routes preserve OperatorAccess, bounds, idempotency, and the live barrier', { concurrency: false }, async () => {
  const state = baseState();
  const persistence = new Persistence(state);
  const composition = new Composition();
  const controls = new SystemControlService({ initialState: state, persistence, composition });
  const calls = { supervisor: 0, graph: 0, events: 0, controls: 0, trace: 0, ops: 0 };
  let eventQuery = null;
  const read = {
    supervisor() {
      calls.supervisor++;
      return {
        schemaVersion: 1, revision: controls.snapshot().revision, evaluatedAtMs: T0,
        phase: 'RUNNING', control: controls.snapshot(), truthLabel: 'DRY_RUN',
        components: [], edges: [], rootBlockerComponentIds: [], operatorAttentionComponentIds: [],
      };
    },
    graph() { calls.graph++; return { revision: 1, evaluatedAtMs: T0, edges: [] }; },
    events(query) {
      calls.events++;
      eventQuery = query;
      return { items: [], nextBeforeId: null, nextAfterId: null };
    },
    controls() { calls.controls++; return controls.snapshot(); },
    trace(correlationId) {
      calls.trace++;
      return correlationId === 'cor_present'
        ? { correlationId, evaluatedAtMs: T0, events: [], truncated: false }
        : null;
    },
  };
  const opsReadback = {
    read() { calls.ops++; return OPS_READBACK; },
  };
  let validateOnlyCalls = 0;
  let validateOnlyInput = null;
  const validateOnly = {
    async executeValidateOnly(input) {
      validateOnlyCalls++;
      validateOnlyInput = input;
      return {
        ok: true,
        snapshot: {
          disposition: 'READY',
          rootCorrelationId: input.correlationId,
          executionAuthority: 'NONE',
          liveExecutionPermitted: false,
        },
      };
    },
  };
  let now = T0 + 1_000;
  const router = createSystemIntegrationRouter({ read, controls, validateOnly, clock: { nowMs: () => now++ }, opsReadback });
  const access = new OperatorAccess();
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use((req, res, next) => {
    if (/^\/api(?:\/|$)/i.test(req.path)) res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.use(express.json({ limit: '192kb', strict: true }));
  app.use('/api', access.middleware());
  app.use('/api/system-integration', router);
  app.use((error, _req, res, _next) => {
    const tooLarge = error?.type === 'entity.too.large' || error?.status === 413;
    const malformed = error?.type === 'entity.parse.failed';
    res.status(tooLarge ? 413 : malformed ? 400 : 500).json({
      ok: false,
      code: tooLarge ? 'BODY_TOO_LARGE' : malformed ? 'INVALID_JSON' : 'INTERNAL_ERROR',
      error: 'Request rejected.',
    });
  });
  const server = http.createServer(app);
  const base = await listen(server);
  const fetchLocal = (path, init = {}) => fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
  const post = (body, key = 'route.control.0001', headers = {}) => fetchLocal('/api/system-integration/controls', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key, ...headers },
    body: JSON.stringify(body),
  });

  try {
    const supervisor = await fetchLocal('/api/system-integration/supervisor');
    assert.equal(supervisor.status, 200);
    assert.match(supervisor.headers.get('cache-control') ?? '', /private, no-store/);
    assert.equal(supervisor.headers.get('x-powered-by'), null);
    assert.equal((await json(supervisor)).truthLabel, 'DRY_RUN');
    assert.equal(calls.supervisor, 1);

    const ops = await fetchLocal('/api/system-integration/ops/readback');
    assert.equal(ops.status, 200);
    assert.deepEqual(await json(ops), OPS_READBACK);
    const interlock = await fetchLocal('/api/system-integration/ops/intake-gate');
    assert.equal(interlock.status, 200);
    assert.deepEqual(await json(interlock), {
      source: 'CANONICAL_OPS_INTAKE_INTERLOCK',
      state: 'OPS_INTERLOCK_CLEAR',
      blocksNewEntries: false,
      externalActionAuthorization: 'NONE',
      evaluatedAtUtc: new Date(T0 + 1_000).toISOString().replace('.000Z', 'Z'),
      readbackValidUntilUtc: OPS_READBACK.validUntilUtc,
      reasonCodes: [],
    });
    assert.equal(calls.ops, 2);
    assert.equal(persistence.commits.length, 0, 'ops reads must not mutate controls');

    const opsQuery = await fetchLocal('/api/system-integration/ops/readback?refresh=1');
    assert.equal(opsQuery.status, 400);
    assert.equal((await json(opsQuery)).code, 'REFRESH_REQUIRES_POST');
    assert.equal(calls.ops, 2);

    const forgedEdge = await fetchLocal('/api/system-integration/supervisor', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    assert.equal(forgedEdge.status, 401);
    assert.equal((await json(forgedEdge)).code, 'OPERATOR_NOT_CONFIGURED');
    assert.equal(calls.supervisor, 1);

    const crossSite = await fetchLocal('/api/system-integration/supervisor', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 401);
    assert.equal((await json(crossSite)).code, 'CROSS_SITE_REQUEST');
    assert.equal(calls.supervisor, 1);

    const foreignRead = await fetchLocal('/api/system-integration/supervisor', {
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(foreignRead.status, 401);
    assert.equal((await json(foreignRead)).code, 'ORIGIN_MISMATCH');
    assert.equal(calls.supervisor, 1);

    const refresh = await fetchLocal('/api/system-integration/supervisor?refresh=1');
    assert.equal(refresh.status, 400);
    assert.equal((await json(refresh)).code, 'REFRESH_REQUIRES_POST');
    assert.equal(calls.supervisor, 1, 'read refresh must not call read owner');
    assert.equal(persistence.commits.length, 0, 'reads must not mutate controls');

    for (const query of ['?limit=0', '?limit=1.5', '?limit=201', '?limit=10&beforeId=a&afterId=b', '?target=https://evil.example']) {
      const response = await fetchLocal(`/api/system-integration/events${query}`);
      assert.equal(response.status, 400, query);
      assert.equal((await json(response)).code, 'INVALID_SYSTEM_QUERY', query);
    }
    assert.equal(calls.events, 0);
    const events = await fetchLocal('/api/system-integration/events?limit=200&afterId=evt_10');
    assert.equal(events.status, 200);
    assert.deepEqual(eventQuery, { limit: 200, afterId: 'evt_10' });

    const invalidTrace = await fetchLocal('/api/system-integration/traces/%2E%2E%2Fsecret');
    assert.equal(invalidTrace.status, 400);
    assert.equal((await json(invalidTrace)).code, 'INVALID_TRACE_ID');
    const absentTrace = await fetchLocal('/api/system-integration/traces/cor_absent');
    assert.equal(absentTrace.status, 404);
    assert.equal((await json(absentTrace)).code, 'TRACE_NOT_FOUND');
    const presentTrace = await fetchLocal('/api/system-integration/traces/cor_present');
    assert.equal(presentTrace.status, 200);

    const validateOnlyResponse = await fetchLocal('/api/system-integration/validate-only', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestedMode: 'VALIDATE_ONLY',
        correlationId: 'cor_route_validate_only',
        nowMs: 1,
      }),
    });
    assert.equal(validateOnlyResponse.status, 200);
    assert.deepEqual(await json(validateOnlyResponse), {
      ok: true,
      snapshot: {
        disposition: 'READY',
        rootCorrelationId: 'cor_route_validate_only',
        executionAuthority: 'NONE',
        liveExecutionPermitted: false,
      },
    });
    assert.equal(validateOnlyCalls, 1);
    assert.equal(validateOnlyInput.nowMs, T0 + 1_001, 'route must replace untrusted client time with its injected clock');

    const validateOnlyNoContentType = await fetchLocal('/api/system-integration/validate-only', {
      method: 'POST',
      body: JSON.stringify({ requestedMode: 'VALIDATE_ONLY' }),
    });
    assert.equal(validateOnlyNoContentType.status, 415);
    assert.equal((await json(validateOnlyNoContentType)).code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(validateOnlyCalls, 1);

    const noContentType = await fetchLocal('/api/system-integration/controls', {
      method: 'POST', body: JSON.stringify({ command: 'SET_SAFE_MODE' }),
    });
    assert.equal(noContentType.status, 415);
    assert.equal((await json(noContentType)).code, 'UNSUPPORTED_MEDIA_TYPE');

    const malformed = await fetchLocal('/api/system-integration/controls', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'route.bad.0001' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await json(malformed)).code, 'INVALID_JSON');

    const oversized = await fetchLocal('/api/system-integration/controls', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'route.large.0001' },
      body: JSON.stringify({ padding: 'x'.repeat(200 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await json(oversized)).code, 'BODY_TOO_LARGE');

    for (const safeMode of ['LIVE', 'LIVE_MANUAL', 'MANUAL_ARMED', 'EXECUTION_LIVE', 'AUTONOMOUS']) {
      const blocked = await post({
        command: 'SET_SAFE_MODE', expectedRevision: 0,
        reason: 'Prove live mode remains mechanically blocked', safeMode,
      }, `route.live.${safeMode}`);
      assert.equal(blocked.status, 409, safeMode);
      assert.equal((await json(blocked)).code, 'LIVE_EXECUTION_NOT_IMPLEMENTED', safeMode);
      assert.equal(controls.snapshot().revision, 0, safeMode);
    }
    assert.equal(composition.inspected.length, 0, 'live block occurs before composition');
    assert.equal(persistence.commits.length, 0, 'live block occurs before persistence');
    assert.equal(persistence.rejections.filter((entry) => entry.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED').length, 5);
    const liveReplay = await post({
      command: 'SET_SAFE_MODE', expectedRevision: 0,
      reason: 'Prove live mode remains mechanically blocked', safeMode: 'LIVE',
    }, 'route.live.LIVE');
    assert.equal(liveReplay.status, 409);
    assert.equal((await json(liveReplay)).code, 'LIVE_EXECUTION_NOT_IMPLEMENTED');
    assert.equal(
      persistence.rejections.filter((entry) => entry.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED').length,
      5,
      'route-level live rejection must be ledgered once per idempotency key',
    );

    const arbitrary = await post({
      command: 'RESTART_COMPONENT', expectedRevision: 0,
      reason: 'Attempt arbitrary target injection', componentId: 'basis-engine',
      target: 'https://evil.example', commandLine: 'rm -rf /',
    }, 'route.arbitrary.0001');
    assert.equal(arbitrary.status, 400);
    assert.equal((await json(arbitrary)).code, 'INVALID_CONTROL_REQUEST');

    const foreignMutation = await post({
      command: 'SET_SAFE_MODE', expectedRevision: 0,
      reason: 'Foreign origin must not mutate', safeMode: 'ADVISORY',
    }, 'route.foreign.0001', { origin: 'https://evil.example' });
    assert.equal(foreignMutation.status, 401);
    assert.equal((await json(foreignMutation)).code, 'ORIGIN_MISMATCH');
    assert.equal(controls.snapshot().revision, 0);

    const body = {
      command: 'SET_SAFE_MODE', expectedRevision: 0,
      reason: 'Move the integration shell to advisory mode', safeMode: 'ADVISORY',
    };
    const applied = await post(body, 'route.apply.0001');
    const appliedBody = await json(applied);
    assert.equal(applied.status, 200);
    assert.equal(appliedBody.ok, true);
    assert.equal(appliedBody.after.revision, 1);
    assert.equal(appliedBody.after.safeMode, 'ADVISORY');
    assert.equal(persistence.commits.length, 1);
    assert.equal(persistence.commits[0].actor.id, 'local-operator');

    const replay = await post(body, 'route.apply.0001');
    assert.equal(replay.status, 200);
    assert.deepEqual(await json(replay), appliedBody);
    assert.equal(persistence.commits.length, 1);

    const conflict = await post({ ...body, safeMode: 'VALIDATE_ONLY' }, 'route.apply.0001');
    assert.equal(conflict.status, 409);
    assert.equal((await json(conflict)).code, 'IDEMPOTENCY_KEY_CONFLICT');

    const stale = await post({ ...body, safeMode: 'VALIDATE_ONLY' }, 'route.stale.0001');
    assert.equal(stale.status, 409);
    assert.equal((await json(stale)).code, 'STALE_COMMAND_REVISION');
    assert.equal(controls.snapshot().revision, 1);
  } finally {
    await close(server);
  }

  const missingOperatorApp = express();
  missingOperatorApp.use('/api/system-integration', createSystemIntegrationRouter({
    read,
    controls,
    validateOnly,
    clock: { nowMs: () => now++ },
    opsReadback,
  }));
  const missingOperatorServer = http.createServer(missingOperatorApp);
  const missingOperatorBase = await listen(missingOperatorServer);
  try {
    const response = await fetch(`${missingOperatorBase}/api/system-integration/supervisor`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).code, 'OPERATOR_REQUIRED');
    assert.equal(calls.supervisor, 1, 'route must not call the read port without res.locals.operator');
  } finally {
    await close(missingOperatorServer);
  }
});
