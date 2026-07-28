import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
} from '../../../dist/foundation/execution/spotValidateOnly.js';
import {
  SPOT_TRANSPORT_COORDINATOR_POSTURE,
  runSpotTransportCoordinator,
} from '../../../dist/foundation/execution/spotTransportCoordinator.js';
import {
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  createBinanceSpotExecutionAdapter,
} from '../../../dist/liveEdge/adapters/binanceSpotExecution/adapter.js';
import {
  generateM0AutomaticReceipt,
} from '../../../dist/systemIntegration/evidence/m0AutomaticReceipt.js';

const AUTHORITY_FIELDS = Object.freeze([
  'executionAuthority',
  'routeAuthority',
  'persistenceAuthorization',
  'externalActionAuthorization',
]);

const EFFECT_FIELDS = Object.freeze([
  'sendsPerformed',
  'sideEffectsPerformed',
  'networkCallsPerformed',
  'credentialReadsPerformed',
  'privateReadsPerformed',
  'providerCallsPerformed',
  'moneyMutationsPerformed',
  'persistenceWritesPerformed',
  'controlMutationsPerformed',
]);

function assertNotProvedReceipt(receipt) {
  assert.equal(receipt.disposition, 'NOT_PROVED');
  assert.equal(receipt.milestoneClaim, 'NOT_PROVED');
  assert.equal(receipt.mode, 'VALIDATE_ONLY');
  for (const field of AUTHORITY_FIELDS) assert.equal(receipt[field], 'NONE');
  assert.deepEqual(receipt.permittedExternalActions, []);
  assert.equal(receipt.liveCanaryProven, false);
  assert.equal(receipt.moneyMovementProven, false);
  assert.equal(receipt.providerAcceptance, 'NOT_CLAIMED');
  for (const field of EFFECT_FIELDS) assert.equal(receipt[field], 0);
  for (const axis of Object.values(receipt.axes)) {
    assert.equal(axis.state, 'NOT_PROVED');
  }
}

test('M0 Spot canary source defaults remain frozen and fail closed', () => {
  assert.equal(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.sourceEnabled, false);
  assert.equal(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.killSwitchEngaged, true);
  assert.deepEqual(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.allowedSymbols, []);
  assert.equal(Object.isFrozen(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG), true);
  assert.equal(
    Object.isFrozen(DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.allowedSymbols),
    true,
  );

  assert.deepEqual(SPOT_TRANSPORT_COORDINATOR_POSTURE, {
    liveMounted: false,
    liveExportReachable: false,
    sharedBarrelExported: false,
    automaticMutationRetry: false,
  });
  assert.equal(Object.isFrozen(SPOT_TRANSPORT_COORDINATOR_POSTURE), true);
  assert.equal(
    BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    'cosmos.live-edge.binance-spot-execution-adapter.v1',
  );
});

test('default and malformed automatic receipts prove no action', () => {
  for (const input of [undefined, { forged: true }]) {
    assertNotProvedReceipt(generateM0AutomaticReceipt(input));
  }
});

test('default admission blocks adapter-to-coordinator composition before effects', async () => {
  const calls = {
    admission: 0,
    input: 0,
    clock: 0,
    transport: 0,
    adapterVerifier: 0,
    evidenceVerifier: 0,
    authority: 0,
    ledger: 0,
    flatEvidence: 0,
  };
  const trap = (field) => () => {
    calls[field] += 1;
    throw new Error(`unexpected ${field} call`);
  };
  const executionPort = createBinanceSpotExecutionAdapter({
    send: trap('transport'),
    verifyLiveSubmitIntent: trap('adapterVerifier'),
    verifyFlattenIntent: trap('adapterVerifier'),
    verifyCancelIntent: trap('adapterVerifier'),
  });
  const hostileInput = new Proxy(Object.create(null), {
    get() {
      calls.input += 1;
      throw new Error('coordinator input must remain unread');
    },
  });
  const admission = Object.freeze({
    ...DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
    revision: 'm0-source-boundary-inert-v1',
  });

  const result = await runSpotTransportCoordinator(
    'BTCUSDT',
    hostileInput,
    {
      clock: Object.freeze({ nowMs: trap('clock') }),
      executionPort,
      readAdmission() {
        calls.admission += 1;
        return admission;
      },
      consumeAuthority: trap('authority'),
      verifySignedTestEvidence: trap('evidenceVerifier'),
      appendLedger: trap('ledger'),
      readFlatEvidence: trap('flatEvidence'),
    },
  );

  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.reasonCodes, [
    'KILL_SWITCH_ENGAGED_OR_UNKNOWN',
  ]);
  assert.deepEqual(result.calls, {
    admissions: 1,
    signedTests: 0,
    authorityConsumptions: 0,
    submits: 0,
    orderQueries: 0,
    fillQueries: 0,
    cancels: 0,
    flattens: 0,
    ledgerAppends: 0,
  });
  assert.deepEqual(calls, {
    admission: 1,
    input: 0,
    clock: 0,
    transport: 0,
    adapterVerifier: 0,
    evidenceVerifier: 0,
    authority: 0,
    ledger: 0,
    flatEvidence: 0,
  });
  assert.equal(result.executionAuthority, 'NONE');
  assert.equal(result.externalActionAuthorization, 'NONE');
});

test('Spot canary has one source-only runtime owner and remains absent from shared barrels', async () => {
  const sharedBarrelUrls = [
    '../../../src/foundation/execution/index.ts',
    '../../../src/liveEdge/index.ts',
    '../../../src/systemIntegration/index.ts',
  ].map((path) => new URL(path, import.meta.url));
  const sharedBarrels = (await Promise.all(
    sharedBarrelUrls.map((url) => readFile(url, 'utf8')),
  )).join('\n');
  const runtimeBootstrap = await readFile(
    new URL('../../../src/index.ts', import.meta.url),
    'utf8',
  );
  const runtimeOwner = await readFile(
    new URL('../../../src/systemIntegration/production/m0SpotRuntime.ts', import.meta.url),
    'utf8',
  );
  const routeSource = await readFile(
    new URL('../../../src/systemIntegration/routes/router.ts', import.meta.url),
    'utf8',
  );
  const proofCatalog = JSON.parse(await readFile(
    new URL('../../../../fixtures/i00/proof-catalog.json', import.meta.url),
    'utf8',
  ));

  for (const forbiddenSourceName of [
    'spotTransportCoordinator',
    'SPOT_TRANSPORT_COORDINATOR_POSTURE',
    'runSpotTransportCoordinator',
    'binanceSpotExecution',
    'BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA',
    'createBinanceSpotExecutionAdapter',
    'm0AutomaticReceipt',
    'generateM0AutomaticReceipt',
  ]) {
    assert.doesNotMatch(sharedBarrels, new RegExp(forbiddenSourceName, 'u'));
    assert.doesNotMatch(runtimeBootstrap, new RegExp(forbiddenSourceName, 'u'));
  }

  assert.equal(
    (runtimeBootstrap.match(/createM0SpotRuntimeMount/gu) ?? []).length,
    2,
  );
  assert.match(runtimeBootstrap, /m0SpotCanary:\s*m0SpotRuntimeMount/u);
  assert.match(runtimeOwner, /runSpotTransportCoordinator/u);
  assert.match(runtimeOwner, /createBinanceSpotExecutionAdapter/u);
  assert.match(runtimeOwner, /generateM0AutomaticReceipt/u);
  assert.doesNotMatch(
    runtimeOwner,
    /process\.env|globalThis\.fetch|node:http|node:https|new\s+BinanceClient|m0SpotSignedTransport|binanceSignedKernel|constructSignedRequest/u,
  );
  assert.equal(
    (routeSource.match(/router\.post\('\/m0\/spot-canary'/gu) ?? []).length,
    1,
  );
  const sourceM0Routes = [...routeSource.matchAll(
    /router\.(get|post|put|delete)\(\s*['"](\/m0\/[^'"]+)['"]/gu,
  )].map((match) => `${match[1].toUpperCase()} /api/system-integration${match[2]}`);
  const catalogM0Routes = proofCatalog.canonicalRoutes
    .filter((route) => route.route.startsWith('/api/system-integration/m0/'))
    .map((route) => `${route.method} ${route.route}`);
  assert.deepEqual(catalogM0Routes, sourceM0Routes);
  assert.deepEqual(
    proofCatalog.canonicalRoutes.find(
      (route) => route.route === '/api/system-integration/m0/spot-canary',
    ),
    {
      method: 'POST',
      route: '/api/system-integration/m0/spot-canary',
      sourceNeedle: "router.post('/m0/spot-canary'",
    },
  );
  assert.doesNotMatch(routeSource, /\/m0\/spot-canary\/(?:send|test|cancel)/u);
  assert.doesNotMatch(
    runtimeBootstrap,
    /spotValidateOnly|DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG/u,
  );
});
