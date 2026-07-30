import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ProductBindingError,
  createProductIntegrationClient,
} from '../../src/lib/productIntegration/client.ts';
import {
  PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX,
  abortActiveCommandResultRead,
  ambiguousCommandResultReconciliation,
  clearDurableCommandResultIdentity,
  persistDurableCommandResultIdentity,
  prepareDurableCommandSubmission,
  readDurableCommandResultIdentity,
  reconcileDurableCommandResult,
  requiresDurableCommandResultReadback,
} from '../../src/lib/productIntegration/commandResultState.ts';
import { createHttpProductIntegrationTransport } from '../../src/lib/productIntegration/httpTransport.ts';

const IDENTITY = Object.freeze({
  commandId: 'sysctrl_0220d4fcf8fd360e0302c22091e57dc02bdf9ebf74393647833c61ece44227eb',
  idempotencyKey: 'ui:component.engine-supervisor.restart:00000000-0000-4000-8000-000000000000',
  controlId: 'component.engine-supervisor.restart',
});

const RESULT = Object.freeze({
  commandId: IDENTITY.commandId,
  controlId: IDENTITY.controlId,
  status: 'ACCEPTED_ASYNC',
  before: 'generation=7',
  after: 'generation=8',
  receiptId: 'ledger-event:41',
  correlationId: 'product.control.0220d4fcf8fd360e0302c22091e57dc02bdf9ebf74393647',
  completedAtMs: 1_800_000_000_000,
  synthetic: false,
});

function clientFor(readCommandResult) {
  return createProductIntegrationClient({
    readSupervisor: async () => ({}),
    readMaterialEvents: async () => ({}),
    readTrace: async () => ({}),
    readCommandResult,
    previewCommand: async () => ({}),
    submitCommand: async () => ({}),
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    provider: () => ({
      get length() { return values.size; },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    }),
  };
}

test('read cancellation cannot clear shared busy state when no result read is active', () => {
  assert.equal(abortActiveCommandResultRead(null), false);
  const controller = new AbortController();
  assert.equal(abortActiveCommandResultRead(controller), true);
  assert.equal(controller.signal.aborted, true);
});

test('browser client exposes and validates pending and terminal durable command-result readback', async () => {
  let response = RESULT;
  let httpStatus = 202;
  const client = clientFor(async () => ({ httpStatus, body: response }));
  assert.equal(typeof client.readCommandResult, 'function');
  assert.deepEqual(await client.readCommandResult(IDENTITY), {
    state: 'PENDING',
    result: RESULT,
    reasonCode: null,
  });

  response = Object.freeze({ ...RESULT, status: 'APPLIED' });
  httpStatus = 200;
  assert.deepEqual(await client.readCommandResult(IDENTITY), {
    state: 'TERMINAL',
    result: response,
    reasonCode: null,
  });

  response = Object.freeze({ ...RESULT, status: 'FAILED_ATTENTION_REQUIRED', receiptId: null });
  httpStatus = 503;
  assert.deepEqual(await client.readCommandResult(IDENTITY), {
    state: 'AMBIGUOUS',
    result: response,
    reasonCode: 'COMMAND_RESULT_FAILED_ATTENTION_REQUIRED',
  });
});

test('command-result readback rejects invalid identity, hostile shapes, and HTTP/body disagreement', async () => {
  let calls = 0;
  const invalidIdentityClient = clientFor(async () => { calls += 1; return { httpStatus: 202, body: RESULT }; });
  await assert.rejects(
    invalidIdentityClient.readCommandResult({ ...IDENTITY, commandId: 'bad' }),
    (error) => error instanceof ProductBindingError
      && error.codes.includes('COMMAND_RESULT_IDENTITY_INVALID'),
  );
  assert.equal(calls, 0);

  for (const [value, code] of [
    [{ ...RESULT, commandId: `sysctrl_${'c'.repeat(64)}` }, 'COMMAND_RESULT_IDENTITY_MISMATCH'],
    [{ ...RESULT, synthetic: true }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, receiptId: null }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, unexpected: true }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, before: '' }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, after: 'x' }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, receiptId: 'arbitrary' }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, correlationId: 'arbitrary' }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, completedAtMs: -1 }, 'COMMAND_RESULT_INVALID'],
    [{ ...RESULT, completedAtMs: 1.5 }, 'COMMAND_RESULT_INVALID'],
  ]) {
    const client = clientFor(async () => ({ httpStatus: 202, body: value }));
    await assert.rejects(
      client.readCommandResult(IDENTITY),
      (error) => error instanceof ProductBindingError && error.codes.includes(code),
    );
  }

  for (const [httpStatus, value] of [
    [200, RESULT],
    [202, { ...RESULT, status: 'APPLIED' }],
    [503, RESULT],
  ]) {
    const client = clientFor(async () => ({ httpStatus, body: value }));
    await assert.rejects(
      client.readCommandResult(IDENTITY),
      (error) => error instanceof ProductBindingError
        && error.codes.includes('COMMAND_RESULT_HTTP_STATUS_MISMATCH'),
    );
  }

  const unavailable = clientFor(async () => ({
    httpStatus: 503,
    body: { ok: false, code: 'COMMAND_RESULT_OWNER_UNAVAILABLE', error: 'Owner unavailable.' },
  }));
  await assert.rejects(
    unavailable.readCommandResult(IDENTITY),
    (error) => error instanceof ProductBindingError
      && error.codes.includes('COMMAND_RESULT_OWNER_UNAVAILABLE'),
  );
});

test('HTTP transport issues one exact same-origin no-store result query', async () => {
  const priorWindow = globalThis.window;
  const priorFetch = globalThis.fetch;
  let observed = null;
  globalThis.window = {
    location: { origin: 'https://control.example' },
    setTimeout,
    clearTimeout,
  };
  globalThis.fetch = async (input, init) => {
    observed = { input: String(input), init };
    return new Response(JSON.stringify(RESULT), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const endpoints = {
      supervisor: '/api/product-integration/v1/supervisor',
      materialEvents: '/api/product-integration/v1/material-events',
      trace: (correlationId) => `/api/product-integration/v1/traces/${correlationId}`,
      commandResult: (commandId) => `/api/product-integration/v1/commands/${commandId}/result`,
      commandPreview: '/api/product-integration/v1/commands/preview',
      commandSubmit: '/api/product-integration/v1/commands',
    };
    const transport = createHttpProductIntegrationTransport(endpoints);
    assert.deepEqual(await transport.readCommandResult(IDENTITY), { httpStatus: 202, body: RESULT });
    const requestUrl = new URL(observed.input, globalThis.window.location.origin);
    assert.equal(requestUrl.pathname, `/api/product-integration/v1/commands/${IDENTITY.commandId}/result`);
    assert.deepEqual([...requestUrl.searchParams.entries()], [
      ['idempotencyKey', IDENTITY.idempotencyKey],
      ['controlId', IDENTITY.controlId],
    ]);
    assert.equal(observed.init.cache, 'no-store');
    assert.equal(observed.init.credentials, 'same-origin');
    assert.equal(observed.init.method, undefined);

    const incidentId = 'incident.product.market-streams.episode.41';
    await transport.previewCommand(`incident.ack.${'a'.repeat(64)}`, '41', incidentId);
    assert.equal(observed.input, '/api/product-integration/v1/commands/preview');
    assert.equal(observed.init.method, 'POST');
    assert.deepEqual(JSON.parse(observed.init.body), {
      controlId: `incident.ack.${'a'.repeat(64)}`,
      expectedRevision: '41',
      targetId: incidentId,
    });

    const attention = Object.freeze({ ...RESULT, status: 'FAILED_ATTENTION_REQUIRED', receiptId: null });
    globalThis.fetch = async () => new Response(JSON.stringify(attention), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.deepEqual(await transport.readCommandResult(IDENTITY), { httpStatus: 503, body: attention });

    const crossOrigin = createHttpProductIntegrationTransport({
      ...endpoints,
      commandResult: () => 'https://attacker.invalid/result',
    });
    assert.throws(() => crossOrigin.readCommandResult(IDENTITY), /PRODUCT_ENDPOINT_MUST_BE_SAME_ORIGIN/);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
    if (priorFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = priorFetch;
  }
});

test('one pending identity persists across reconstruction and only terminal truth clears it', () => {
  const storage = memoryStorage();
  assert.equal(persistDurableCommandResultIdentity(IDENTITY, storage.provider).state, 'PENDING');
  assert.deepEqual(readDurableCommandResultIdentity(storage.provider).identity, IDENTITY);
  assert.equal(storage.values.size, 1);

  const ambiguous = ambiguousCommandResultReconciliation(IDENTITY, RESULT, 'COMMAND_RESULT_NOT_FOUND');
  assert.equal(ambiguous.state, 'AMBIGUOUS');
  assert.equal(storage.values.has(`${PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX}${IDENTITY.commandId}`), true);

  for (const nonterminal of [
    RESULT,
    { ...RESULT, status: 'FAILED_ATTENTION_REQUIRED', receiptId: null },
    { ...RESULT, status: 'APPLIED', synthetic: true },
    { ...RESULT, status: 'APPLIED', receiptId: 'not-a-ledger-receipt' },
  ]) {
    assert.equal(
      clearDurableCommandResultIdentity(IDENTITY, nonterminal, storage.provider).state,
      'INVALID_DURABLE_STATE',
    );
    assert.equal(readDurableCommandResultIdentity(storage.provider).state, 'PENDING');
  }

  const terminal = Object.freeze({ ...RESULT, status: 'APPLIED' });
  assert.equal(clearDurableCommandResultIdentity(IDENTITY, terminal, storage.provider).state, 'TERMINAL');
  assert.equal(storage.values.size, 0);
  assert.equal(readDurableCommandResultIdentity(storage.provider).state, 'NONE');
});

test('404, 409, 503, and timeout read failures retain the pending identity as ambiguous', async () => {
  for (const code of [
    'COMMAND_RESULT_NOT_FOUND',
    'COMMAND_RESULT_NOT_CONFIGURED',
    'COMMAND_RESULT_OWNER_UNAVAILABLE',
    'REQUEST_TIMEOUT',
  ]) {
    const storage = memoryStorage();
    assert.equal(persistDurableCommandResultIdentity(IDENTITY, storage.provider).state, 'PENDING');
    const reconciled = await reconcileDurableCommandResult(
      IDENTITY,
      RESULT,
      async () => { throw Object.freeze({ code }); },
      storage.provider,
    );
    assert.equal(reconciled.state, 'AMBIGUOUS');
    assert.equal(reconciled.reasonCode, code);
    assert.deepEqual(readDurableCommandResultIdentity(storage.provider).identity, IDENTITY);
  }
});

test('malformed, unavailable, unverifiable, or uncleared durable state fails closed without deletion', () => {
  const malformed = memoryStorage();
  const durableKey = `${PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX}${IDENTITY.commandId}`;
  malformed.values.set(durableKey, '{not-json');
  assert.equal(readDurableCommandResultIdentity(malformed.provider).state, 'INVALID_DURABLE_STATE');
  assert.equal(malformed.values.get(durableKey), '{not-json');

  assert.equal(
    readDurableCommandResultIdentity(() => { throw new Error('blocked'); }).reasonCode,
    'COMMAND_RESULT_STORAGE_UNAVAILABLE',
  );
  assert.equal(
    persistDurableCommandResultIdentity(IDENTITY, () => ({
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })).reasonCode,
    'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED',
  );
  assert.equal(
    (() => {
      const uncleared = memoryStorage();
      assert.equal(persistDurableCommandResultIdentity(IDENTITY, uncleared.provider).state, 'PENDING');
      return clearDurableCommandResultIdentity(IDENTITY, { ...RESULT, status: 'APPLIED' }, () => ({
      get length() { return uncleared.values.size; },
      key: (index) => [...uncleared.values.keys()][index] ?? null,
      getItem: (key) => uncleared.values.get(key) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
      }));
    })().reasonCode,
    'COMMAND_RESULT_STORAGE_CLEAR_UNVERIFIED',
  );
});

test('submission identity is durable before a commit-then-timeout and blocks a second command after reload', async () => {
  const storage = memoryStorage();
  const expectedDigest = createHash('sha256').update(JSON.stringify({
    controlId: IDENTITY.controlId,
    idempotencyKey: IDENTITY.idempotencyKey,
    schema: 'product-command.v1',
  })).digest('hex');
  const prepared = await prepareDurableCommandSubmission(
    IDENTITY.idempotencyKey,
    IDENTITY.controlId,
    storage.provider,
  );
  assert.equal(prepared.identity.commandId, `sysctrl_${expectedDigest}`);
  assert.equal(prepared.reconciliation.state, 'PENDING');

  let durableBeforePost = false;
  await assert.rejects(async () => {
    durableBeforePost = readDurableCommandResultIdentity(storage.provider).state === 'PENDING';
    throw new Error('REQUEST_TIMEOUT_AFTER_COMMIT');
  }, /REQUEST_TIMEOUT_AFTER_COMMIT/);
  assert.equal(durableBeforePost, true);
  assert.equal(readDurableCommandResultIdentity(storage.provider).state, 'PENDING');

  const second = await prepareDurableCommandSubmission(
    'ui:component.engine-supervisor.restart:11111111-1111-4111-8111-111111111111',
    IDENTITY.controlId,
    storage.provider,
  );
  assert.equal(second.reconciliation.state, 'INVALID_DURABLE_STATE');
  assert.equal(second.reconciliation.reasonCode, 'COMMAND_RESULT_STORAGE_CONFLICT');
  assert.equal(storage.values.size, 1);
});

test('interleaved tabs preserve both identities, report conflict, and reject stale clear', async () => {
  const storage = memoryStorage();
  assert.equal(persistDurableCommandResultIdentity(IDENTITY, storage.provider).state, 'PENDING');
  const other = (await prepareDurableCommandSubmission(
    'ui:component.engine-supervisor.restart:22222222-2222-4222-8222-222222222222',
    IDENTITY.controlId,
    storage.provider,
  )).identity;
  const otherKey = `${PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX}${other.commandId}`;
  storage.values.set(otherKey, JSON.stringify({
    schemaVersion: 'product-command-result-query.v1',
    commandId: other.commandId,
    idempotencyKey: other.idempotencyKey,
    controlId: other.controlId,
  }));
  assert.equal(readDurableCommandResultIdentity(storage.provider).reasonCode, 'COMMAND_RESULT_STORAGE_CONFLICT');
  assert.equal(clearDurableCommandResultIdentity(IDENTITY, RESULT, storage.provider).state, 'INVALID_DURABLE_STATE');
  assert.equal(storage.values.size, 2);

  storage.values.delete(`${PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX}${IDENTITY.commandId}`);
  assert.equal(clearDurableCommandResultIdentity(IDENTITY, RESULT, storage.provider).state, 'INVALID_DURABLE_STATE');
  assert.equal(storage.values.has(otherKey), true);
});

test('pending readback cannot become green when its durable identity cannot be written', async () => {
  const provider = () => ({
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  const reconciled = await reconcileDurableCommandResult(
    IDENTITY,
    RESULT,
    async () => Object.freeze({ state: 'PENDING', result: RESULT, reasonCode: null }),
    provider,
  );
  assert.equal(reconciled.state, 'INVALID_DURABLE_STATE');
  assert.equal(reconciled.reasonCode, 'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED');
});

test('a cancelled stale read cannot resurrect identity after a newer terminal clear', async () => {
  const storage = memoryStorage();
  assert.equal(persistDurableCommandResultIdentity(IDENTITY, storage.provider).state, 'PENDING');
  const terminal = Object.freeze({ ...RESULT, status: 'APPLIED' });
  const stale = await reconcileDurableCommandResult(
    IDENTITY,
    RESULT,
    async () => {
      assert.equal(clearDurableCommandResultIdentity(IDENTITY, terminal, storage.provider).state, 'TERMINAL');
      throw Object.freeze({ code: 'COMMAND_RESULT_READBACK_CANCELLED' });
    },
    storage.provider,
  );
  assert.equal(stale.state, 'NONE');
  assert.equal(readDurableCommandResultIdentity(storage.provider).state, 'NONE');
  assert.equal(storage.values.size, 0);
});

test('async and attention-required submit results require readback, while terminal and fixture results do not', () => {
  assert.equal(requiresDurableCommandResultReadback(RESULT), true);
  assert.equal(requiresDurableCommandResultReadback({ ...RESULT, status: 'FAILED_ATTENTION_REQUIRED' }), true);
  assert.equal(requiresDurableCommandResultReadback({ ...RESULT, status: 'APPLIED' }), false);
  assert.equal(requiresDurableCommandResultReadback({ ...RESULT, synthetic: true }), false);
});

test('production mount wires result endpoint, durable identity, reload read, and manual recheck without polling', async () => {
  const [app, route, transport, panel] = await Promise.all([
    readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/productControlRoom/ProductControlRoomRoute.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/lib/productIntegration/httpTransport.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/productControlRoom/components/ControlRegistryPanel.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /commands\/\$\{encodeURIComponent\(commandId\)\}\/result/);
  assert.match(route, /client\.readCommandResult\(identity, signal\)/);
  assert.match(transport, /searchParams\.set\('idempotencyKey'/);
  assert.match(transport, /searchParams\.set\('controlId'/);
  assert.match(panel, /readDurableCommandResultIdentity\(\)/);
  assert.match(panel, /prepareDurableCommandSubmission\(idempotencyKey, control\.controlId\)/);
  assert.ok(panel.indexOf('prepareDurableCommandSubmission') < panel.indexOf('await onSubmit(request)'));
  assert.match(panel, /queueMicrotask/);
  assert.match(panel, /addEventListener\('storage'/);
  assert.match(panel, /new AbortController\(\)/);
  assert.match(panel, /onReadCommandResult\(query, controller\.signal\)/);
  assert.match(panel, /cancelCommandResultRead\(\)/);
  assert.match(panel, /reconciliationRequestRef\.current !== requestId/);
  assert.match(panel, /Durable command result state is unverifiable/);
  assert.doesNotMatch(
    panel,
    /next\.state === 'INVALID_DURABLE_STATE'[\s\S]{0,240}Terminal result is proven/,
  );
  assert.match(panel, />Recheck Result<\/button>/);
  assert.match(panel, /reconciliationBlocksCommands\(reconciliation\)/);
  assert.doesNotMatch(panel, /setInterval|setTimeout/);
});
