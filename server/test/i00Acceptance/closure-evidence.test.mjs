import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { discoverOperationalPageIds, evaluateLoadShedding, measureResourceHarness, readJson, readText, ROOT, sha256 } from './harness.mjs';
import {
  buildMachineEvidence,
  evidenceDigest,
  normalizeMachineEvidenceAuthority,
  renderReports,
} from '../../../test/i00/render-reports.mjs';
import { verifyReceiptProvenance } from '../../../test/i00/git-provenance.mjs';

const catalog = readJson('fixtures/i00/proof-catalog.json');
const closure = readJson('fixtures/i00/closure-evidence.json');
const STATUS = new Set(['NOT_REQUIRED_FOR_FIRST_PRODUCT', 'DESIGNED', 'BUILT', 'WIRED', 'VISIBLE', 'CONTROLLED', 'LOCAL_PROVED', 'DEPLOYED_PROVED', 'LIVE_OBSERVED', 'OWNER_GATED', 'BLOCKED_EXTERNAL']);
const BINDING_CATEGORY_IDS = Object.freeze([
  'Q-PROTOCOL', 'Q-FRAMEWORK', 'Q-DATA', 'Q-LABELS', 'Q-FEATURES', 'Q-MODELS', 'Q-VALIDATION', 'Q-LEARNING', 'Q-REGISTRY', 'Q-INFERENCE',
  'L-KERNEL', 'L-PROTOCOL-VOCABULARY', 'L-FILTERS', 'L-PRIVATE', 'L-JOURNAL', 'L-TWIN', 'L-POLICY', 'L-BASIS-NORMAL', 'L-BASIS-REVERSE', 'L-VOLUME',
  'L-CAPITAL-RISK', 'L-RECOVERY', 'L-CONTROLS', 'L-OBSERVABILITY', 'L-OPS', 'L-CANARY',
  'I15-PRIVATE-ACCOUNT', 'I15-SPOT-SIGNED', 'I15-USDM-SIGNED', 'I15-MARGIN', 'I15-RECONCILIATION', 'I15-COCKPIT',
  'I00-PAGES', 'I00-CONTROL-SEED',
]);
const CLOSURE_PHASES = Object.freeze({
  NOT_CANDIDATE_READY: Object.freeze({
    productVerdict: 'PENDING_MEASUREMENT',
    measurementStatus: 'PENDING_MEASUREMENT',
    receiptsRequired: false,
  }),
  INTEGRATION_CANDIDATE_READY: Object.freeze({
    productVerdict: 'LOCAL_ACCEPTANCE_MEASURED',
    measurementStatus: 'LOCAL_MEASURED_PASS',
    receiptsRequired: true,
  }),
});

function closurePhase() {
  return CLOSURE_PHASES[closure.candidateState];
}

test('mission coverage rows are complete, unique, and match the legal source-freeze or sealed-candidate phase', () => {
  const ids = new Set();
  for (const row of closure.requirements) {
    assert(!ids.has(row.id), `duplicate ${row.id}`);
    ids.add(row.id);
    for (const field of ['source', 'requirement', 'owner', 'code', 'runtime', 'persistence', 'api', 'cockpit', 'control', 'test', 'scenario', 'status', 'replacement']) {
      assert.equal(typeof row[field], 'string', `${row.id}.${field}`);
      assert(row[field].length > 0, `${row.id}.${field}`);
    }
    assert(STATUS.has(row.status), `${row.id}.status=${row.status}`);
    assert(!['DEPLOYED_PROVED', 'LIVE_OBSERVED'].includes(row.status), `${row.id} unmeasured false-green`);
    if (row.sha !== null) assert(/^[a-f0-9]{40}$/.test(row.sha), `${row.id}.sha`);
    if (row.status !== 'LOCAL_PROVED' && row.blocker === null) throw new Error(`${row.id} missing blocker`);
  }
  assert(ids.has('SAFE-05'));
  assert(ids.has('DASH-10'));
  assert(ids.has('PROTO-01'));
  assert(ids.has('Q-CLOSURE-01'));
  assert(ids.has('L-CLOSURE-01'));
  for (const id of BINDING_CATEGORY_IDS) assert(ids.has(id), `missing binding category ${id}`);
  const phase = closurePhase();
  assert(phase, `unsupported candidate state ${closure.candidateState}`);
  assert.equal(closure.productVerdict, phase.productVerdict);
  const measurements = Object.values(closure.measurements);
  assert.equal(measurements.length, 4);
  assert(measurements.every((row) => row.status === phase.measurementStatus));
  if (phase.receiptsRequired) {
    assert(measurements.every((row) => typeof row.receipt === 'string'
      && row.receipt.startsWith('test/i00/performance/evidence/')));
  } else {
    assert(measurements.every((row) => row.receipt === null));
  }
});

test('accepted evidence references full SHAs and existing receipts', () => {
  const provenance = readJson('fixtures/i00/receipt-provenance.json');
  const verified = verifyReceiptProvenance(provenance);
  assert.equal(verified.passed, true, JSON.stringify(verified.results.filter((result) => !result.passed)));
  assert.equal(provenance.items.length, closure.acceptedEvidence.length);
  const phase2Donors = closure.acceptedEvidence.filter((row) => row.phase2Donor);
  assert(phase2Donors.length > 0);
  assert.equal(closure.donorEquality.status, 'PROVED');
  for (const field of ['expected', 'discovered', 'accepted', 'integrated']) {
    assert.equal(closure.donorEquality[field], phase2Donors.length, `donorEquality.${field}`);
  }
  assert.equal(provenance.verificationBase, catalog.base.head);
  assert.deepEqual(
    provenance.items.filter((item) => !item.ancestorRequired).map((item) => item.sha),
    ['692501587617d4880303fbd747d93e63c376f088'],
  );
  for (const evidence of closure.acceptedEvidence) {
    assert(/^[a-f0-9]{40}$/.test(evidence.sha), evidence.name);
    assert(statSync(path.join(ROOT, evidence.receipt), { throwIfNoEntry: false }), evidence.receipt);
    const proof = provenance.items.find((item) => item.sha === evidence.sha);
    assert(proof, `${evidence.name} provenance`);
    const receipt = readFileSync(path.join(ROOT, proof.receiptPath), 'utf8');
    assert.equal(sha256(proof.receiptPath), proof.receiptSha256, `${evidence.name} receipt hash`);
    assert(receipt.includes(proof.expectedNeedle), `${evidence.name} receipt assertion`);
  }
});

test('autonomy no-terminal resource interface and no-surprises inventories are exact and bounded', () => {
  assert.equal(closure.autonomy.length, 20);
  assert.equal(new Set(closure.autonomy.map((row) => row.layer)).size, 20);
  assert.equal(closure.terminalOperations.length, 21);
  const terminalClasses = new Set(['MOVED_TO_AUTHENTICATED_CONTROL', 'INTENTIONALLY_OWNER_RUNBOOK', 'EXTERNAL_OWNER_ACTION', 'DEFECT', 'NOT_SUPPORTED', 'PENDING_MEASUREMENT', 'OWNER_GATED']);
  assert(closure.terminalOperations.every((row) => terminalClasses.has(row.classification)));
  assert.equal(closure.resourceMetrics.length, 19);
  assert.deepEqual(closure.resourcePriority.map((row) => row.tier), ['P0', 'P1', 'P2', 'P3', 'P4']);
  assert(closure.resourceMetrics.every((row) => closure.resourceHarness.metrics[row.id]));
  assert(closure.resourceMetrics.every((row) => Number.isFinite(closure.resourceHarness.metrics[row.id].softBound)));
  assert(closure.resourceMetrics.every((row) => Number.isFinite(closure.resourceHarness.metrics[row.id].hardBound)));
  assert.equal(closure.interfaces.length, 15);
  assert(closure.interfaces.every((row) => row.officialPage.startsWith('https://') && row.checkedAtUtc === '2026-07-13T00:00:00Z'));
  assert.deepEqual(Object.keys(closure.interfaceClosure).sort(), closure.interfaces.map((row) => row.id).sort());
  assert(Object.values(closure.interfaceClosure).every((row) => row.status.length > 0 && row.blocker.length > 0));
  assert(closure.interfaces.every((row) => !/pin (?:endpoint|per accepted|exact)/i.test(row.limitsWeights)));
  assert.equal(closure.noSurprises.length, 9);
  assert(closure.noSurprises.every((row) => row.evidenceRowCompleteness === 'COMPLETE' && row.productVerdict !== 'PROVED'));
  const allowedLimitationStatuses = new Set(['NOT_CONFIGURED', 'OWNER_GATED', 'UNKNOWN']);
  assert.equal(
    new Set(closure.knownLimitations.map((row) => row.id)).size,
    closure.knownLimitations.length,
    'known limitation IDs must be unique',
  );
  assert(closure.knownLimitations.every((row) => allowedLimitationStatuses.has(row.status)));
  assert(closure.knownLimitations.every((row) => typeof row.reason === 'string' && row.reason.length > 0));
  const limitations = new Map(closure.knownLimitations.map((row) => [row.id, row]));
  for (const id of [
    'PRIVATE_SIGNED_EXCHANGE',
    'Q_PRODUCTION_TRANSPORT',
    'LIVE_EXECUTION',
    'DEPLOYMENT_TARGET',
    'L12_ACTIVE_SUBJECT_PRIVATE_TRUTH',
    'L13_ACCEPTED_PROJECTOR',
    'L14_PRODUCTION_ACTIVATION',
    'FOUNDATION_QUANTITY_PRODUCTION_CONSUMER',
    'MANAGED_RESTART_EFFECT',
    'PRODUCTION_CAPACITY',
    'PRODUCT_ASSURANCE_PRODUCTION_PROJECTION',
  ]) {
    assert(limitations.has(id), `missing non-green boundary ${id}`);
    assert.notEqual(limitations.get(id).status, 'LOCAL_PROVED');
  }
  assert.match(limitations.get('A_FORMAL').reason, /POST_LANDING_EXCLUDED_BY_L_LAST_ORDERING/);
  assert.match(limitations.get('A_ACTION_EVIDENCE_S2').reason, /POST_LANDING_ONLY_EXCLUDED/);
});

test('dated official-interface facts pin the selected Spot SBE user-data and margin contracts', () => {
  const byId = new Map(closure.interfaces.map((row) => [row.id, row]));
  const spot = byId.get('IF-SPOT-WS');
  assert(spot.officialPage.endsWith('/products/spot/web-socket-streams'));
  assert.match(spot.hostRoute, /stream\.binance\.com:9443\|443/);
  assert.match(spot.lifetimeKeepaliveReconnect, /24h.*ping 20s.*within 1m/);
  assert.match(spot.limitsWeights, /5 incoming messages\/s; 1024 streams\/connection; 300 connection attempts\/5m\/IP/);

  const user = byId.get('IF-SPOT-USER');
  assert(user.officialPage.endsWith('/products/spot/user-data-stream'));
  assert.match(user.operation, /executionReport/);
  assert.match(user.authSignature, /API-key authenticated WebSocket API session/);

  const sbe = byId.get('IF-SPOT-SBE');
  assert.match(sbe.hostRoute, /stream-sbe\.binance\.com/);
  assert.match(sbe.authSignature, /Ed25519.*no signature or timestamp/);
  assert.match(sbe.lifetimeKeepaliveReconnect, /24h.*microsecond timestamps/);
  assert.match(sbe.limitsWeights, /5 client requests\/s; 1024 streams\/connection; 300 connection attempts\/5m\/IP; depth 25ms; depth20 50ms/);

  assert.equal(byId.get('IF-MARGIN-MAX').limitsWeights, 'IP weight 50');
  assert.equal(byId.get('IF-MARGIN-MUTATE').limitsWeights, 'Account Weight 1500');
  assert.equal(byId.get('IF-SPOT-EXCHANGEINFO').limitsWeights, 'request weight 20');
  assert.equal(byId.get('IF-USDM-EXCHANGEINFO').limitsWeights, 'request weight 1');
  assert.equal(byId.get('IF-USDM-TEST').limitsWeights, 'request weight 1');
});

test('resource measurement plan computes quantiles breaches and P0-first load shedding deterministically', () => {
  const samples = readJson('fixtures/i00/resource-samples.json');
  const measured = measureResourceHarness(closure, samples);
  assert.equal(measured.truthLabel, 'SYNTHETIC_MEASUREMENT_PLAN');
  assert.equal(measured.p0InvariantPassed, true);
  assert.equal(measured.metrics.CPU.p50, 65);
  assert.equal(measured.metrics.CPU.p95, 80);
  assert.equal(measured.metrics.CPU.breachState, 'DEGRADED');
  assert.equal(measured.metrics.MEMORY.breachState, 'OK');
  assert.equal(measured.metrics.PRIVATE_RATE.breachState, 'UNAVAILABLE');
  assert.equal(measured.metrics.Q_RATE_LATENCY.breachState, 'UNAVAILABLE');
  const shedding = evaluateLoadShedding(samples);
  assert.deepEqual(shedding.map((decision) => decision.shed), [['P4'], ['P4', 'P3'], ['P4', 'P3', 'P2']]);
  assert(shedding.every((decision) => decision.preserved.includes('P0') && decision.preserved.includes('P1')));
  assert(shedding.every((decision) => decision.materialLoss.P0 === 0 && decision.materialLoss.P1 === 0));
});

test('page capability and control matrices separate historical fixtures from current source closure', () => {
  assert.equal(catalog.pages.length, 21);
  assert.deepEqual(catalog.pages.map((row) => row.pageId).sort(), discoverOperationalPageIds());
  assert.deepEqual(
    catalog.pages.filter((row) => row.mountState === 'NOT_APPLICABLE').map((row) => row.pageId).sort(),
    ['calendar', 'news'],
  );
  assert.equal(catalog.pages.filter((row) => row.mountState === 'WIRED').length, 19);
  assert(catalog.pages.every((row) => row.mountState === 'WIRED' || row.mountState === 'NOT_APPLICABLE'));
  assert.equal(catalog.capabilities.length, 10);
  assert.equal(catalog.controls.length, 14);
  assert(catalog.capabilities.every((row) => row.fixtureState === 'SYNTHETIC_ONLY'));
  assert(catalog.capabilities.every((row) => typeof row.closureState === 'string' && row.closureState.length > 0));
  assert(catalog.pages.every((row) => row.blocker && row.errorBehavior));
  assert(catalog.pages.every((row) => typeof row.closureState === 'string' && row.closureState.length > 0));
  assert(catalog.pages.every((row) => ['SYNTHETIC_ONLY', 'NOT_CONFIGURED', 'BASE_REALITY_UNVERIFIED'].includes(row.fixtureState)));
  assert(catalog.controls.every((row) => row.bounded === true && row.moneyIncreasing === false));
  const controlFields = [
    'id', 'command', 'group', 'label', 'explanation', 'owner', 'targetTypes', 'payloadSchema', 'safeBounds', 'defaultValue',
    'semantics', 'effect', 'requiredPosture', 'confirmation', 'expiryMs', 'reversible', 'previewProvider', 'invariants', 'telemetry', 'wiringState',
    'runtimeControlId', 'closureState',
  ];
  for (const control of catalog.controls) {
    for (const field of controlFields) assert.notEqual(control[field], undefined, `${control.id}.${field}`);
    assert(control.wiringState === 'WIRED_SOURCE' || control.wiringState.startsWith('OWNER_GATED:')
      || control.wiringState.startsWith('NOT_CONFIGURED:'));
  }
  const wired = catalog.controls.filter((row) => row.wiringState === 'WIRED_SOURCE');
  assert.deepEqual(wired.map((row) => row.id).sort(), ['CTRL-INTAKE', 'CTRL-KILL', 'CTRL-MODE', 'CTRL-RESTART']);
  assert.deepEqual(wired.map((row) => row.runtimeControlId).sort(), [
    'component.engine-supervisor.restart', 'global.intake.pause', 'global.kill-switch.engage', 'global.safe-mode.read-only',
  ]);
  assert(wired.every((row) => row.reversible === false && row.closureState === 'SOURCE_BUILT_RUNTIME_MEASUREMENT_PENDING'));
  assert.equal(catalog.controls.find((row) => row.id === 'CTRL-KILL').payloadSchema, '{engaged:true}');
  assert.equal(catalog.controls.find((row) => row.id === 'CTRL-MODE').payloadSchema, '{safeMode:READ_ONLY}');
  assert.equal(catalog.controls.find((row) => row.id === 'CTRL-INTAKE').payloadSchema, '{paused:true}');
  assert.equal(catalog.controls.find((row) => row.id === 'CTRL-RESTART').payloadSchema, '{componentId:engine-supervisor}');
  assert.deepEqual(catalog.requiredAbsentSurfaces, []);
  assert.equal(catalog.canonicalRoutes.length, 15);
  assert.deepEqual(
    catalog.canonicalRoutes
      .filter((route) => route.route.startsWith('/api/product-integration'))
      .map(({ method, route }) => `${method} ${route}`),
    [
      'GET /api/product-integration/v1/supervisor',
      'GET /api/product-integration/v1/material-events',
      'GET /api/product-integration/v1/traces/:correlationId',
      'POST /api/product-integration/v1/commands/preview',
      'GET /api/product-integration/v1/commands/:commandId/result',
      'POST /api/product-integration/v1/commands',
    ],
  );
  const commandResultRoute = catalog.canonicalRoutes.find((route) => route.route === '/api/product-integration/v1/commands/:commandId/result');
  assert.deepEqual(commandResultRoute, {
    method: 'GET',
    route: '/api/product-integration/v1/commands/:commandId/result',
    sourceNeedle: "router.get('/v1/commands/:commandId/result'",
    operatorIdentity: 'SERVER_DERIVED_AUTHENTICATED',
    owner: 'systemIntegration.canonical-control-service',
    queryKeys: ['idempotencyKey', 'controlId'],
    identityContract: {
      commandId: 'sysctrl_[a-f0-9]{64}',
      idempotencyKey: '[A-Za-z0-9][A-Za-z0-9._:-]{7,127}',
      controlId: '[a-z0-9][a-z0-9.-]{0,159}',
    },
    responseStates: {
      TERMINAL: 200,
      PENDING: 202,
      NOT_FOUND_OR_IDENTITY_MISMATCH: 404,
      OWNER_NOT_CONFIGURED: 409,
      FAIL_CLOSED_OR_OWNER_UNAVAILABLE_OR_INVALID: 503,
    },
    proofState: 'SOURCE_BUILT_FOCUSED_PROVED',
    acceptanceBlocker: 'RUNTIME_CONTROL_MEASUREMENT_PENDING; RUNTIME_BROWSER_MEASUREMENT_PENDING',
  });
  assert(catalog.pages.find((page) => page.pageId === 'control-room').canonicalApi
    .includes('/api/product-integration/v1/commands/:commandId/result'));
});

test('generated Markdown reports are byte-identical to machine evidence rendering', () => {
  const reports = renderReports(closure);
  for (const [relativePath, expected] of Object.entries(reports)) {
    assert.equal(readFileSync(path.join(ROOT, relativePath), 'utf8'), expected, relativePath);
  }
});

test('machine evidence is stable across protected-owner transport modes and moving descendant tips', () => {
  const row = (evidenceMode) => ({ path: 'IP_PROOF.md', evidenceMode, passed: true });
  const authority = (evidenceMode, liveSourceTip) => normalizeMachineEvidenceAuthority({
    frozenInputs: [row(evidenceMode)],
    historicalFrozenInputs: [row(evidenceMode)],
    livingDirectorInputAcceptance: {
      sourceCutoffCommit: 'd78be24f4da14632c857ee250b62e3fec33c2743',
      sourceTip: 'd78be24f4da14632c857ee250b62e3fec33c2743',
      liveSourceTip,
      cutoffReachable: true,
      directiveResults: [row(evidenceMode)],
      passed: true,
    },
  });
  assert.deepEqual(
    authority('LIVE_OWNER_FILE', '1'.repeat(40)),
    authority('SEALED_CANDIDATE_HASH', '2'.repeat(40)),
  );
  assert.equal(authority('LIVE_OWNER_FILE', '1'.repeat(40)).livingDirectorInputAcceptance.liveSourceTip, undefined);
  assert.equal(
    authority('LIVE_OWNER_FILE', '1'.repeat(40)).livingDirectorInputAcceptance.liveSourceTipDisposition,
    'MOVING_REF_DESCENDANT_OBSERVED_NOT_SEALED',
  );
  assert.equal(
    authority('INVENTED', '1'.repeat(40)).frozenInputs[0].evidenceMode,
    'INVENTED',
    'invalid modes are never normalized into accepted evidence',
  );
  const unreachable = normalizeMachineEvidenceAuthority({
    frozenInputs: [row('LIVE_OWNER_FILE')],
    historicalFrozenInputs: [row('LIVE_OWNER_FILE')],
    livingDirectorInputAcceptance: {
      sourceCutoffCommit: 'd78be24f4da14632c857ee250b62e3fec33c2743',
      sourceTip: 'd78be24f4da14632c857ee250b62e3fec33c2743',
      liveSourceTip: '3'.repeat(40),
      cutoffReachable: false,
      directiveResults: [row('LIVE_OWNER_FILE')],
      passed: false,
    },
  }).livingDirectorInputAcceptance;
  assert.equal(unreachable.liveSourceTip, '3'.repeat(40));
  assert.equal(unreachable.liveSourceTipDisposition, 'MOVING_REF_REACHABILITY_UNPROVEN');
  const missingTip = normalizeMachineEvidenceAuthority({
    frozenInputs: [],
    historicalFrozenInputs: [],
    livingDirectorInputAcceptance: {
      cutoffReachable: true,
      directiveResults: [],
      passed: false,
    },
  }).livingDirectorInputAcceptance;
  assert.equal(missingTip.liveSourceTipDisposition, 'MOVING_REF_TIP_UNAVAILABLE_OR_INVALID');
});

test('current machine evidence is input-driven for both legal candidate phases and historical IP-PROOF evidence stays historical', () => {
  const current = buildMachineEvidence();
  const phase = closurePhase();
  assert(phase);
  assert.equal(current.targetState, 'CANDIDATE_SOURCE_FROZEN');
  assert.equal(current.productVerdict, phase.productVerdict);
  assert.equal(current.candidateState, closure.candidateState);
  assert.equal(current.counts.phase2Donors, closure.acceptedEvidence.filter((row) => row.phase2Donor).length);
  assert.equal(current.counts.provenanceItems, readJson('fixtures/i00/receipt-provenance.json').items.length);
  assert(current.frozenInputs.every((input) => input.passed), JSON.stringify(current.frozenInputs.filter((input) => !input.passed)));
  assert.equal(current.historicalFrozenInputs.filter((input) => input.passed).length, 12);
  assert.deepEqual(current.historicalFrozenInputs.filter((input) => !input.passed).map((input) => input.path), [
    'QL_DIRECTOR_STATE.md',
    'QL_PARALLEL_DAG.md',
  ]);
  assert.equal(current.livingDirectorInputAcceptance.passed, true);
  assert(current.authority.scanPassed);
  assert.equal(current.authority.authorityConverged, true);
  assert.equal(current.authority.unresolvedConflictCount, 0);
  assert(current.receiptProvenanceVerification.passed);
  assert(current.routes.every((route) => route.observed));
  assert(Object.values(current.measurements).every((row) => row.status === phase.measurementStatus));

  const actual = JSON.parse(readFileSync(path.join(ROOT, 'integration/reports/i00-proof-evidence.json'), 'utf8'));
  const { evidenceSha256: actualDigest, ...actualBody } = actual;
  assert.deepEqual(actualBody, current);
  assert.equal(actualDigest, evidenceDigest(current));
  assert.equal(actual.packet, 'I00_PHASE2_CLOSURE');
  assert.equal(actual.targetState, 'CANDIDATE_SOURCE_FROZEN');
  assert.equal(catalog.historicalPacket.machineEvidenceGitObject, '23e985c17b9b860fee26be397fa05b26f3daf8f2:integration/reports/i00-proof-evidence.json');
  assert.equal(catalog.historicalPacket.machineEvidenceSha256, '3d132f701f9de90e0f9260a3e4f0b86d55459f14306abd5cf7d6a1968a013c64');
});

test('historical IP-PROOF seal remains immutable historical packet evidence', () => {
  const state = readText('IP_PROOF_STATE.md');
  const receipt = readText('IP_PROOF_RECEIPT.md');
  for (const document of [state, receipt]) {
    assert(document.includes('PROOF_PRESTAGE_READY'));
    assert(document.includes('88430c6a0e4850823f631c6b72afbfe2b6bb8b37'));
    assert(document.includes('node packages/edge-protocol-tests/protocol.test.mjs'));
    assert(document.includes('npm run test:all'));
  }
  assert(receipt.includes('83f730e10b73e1c7a0ab098b9f0d32a97d90424c14625359acc7d344c4889ab2'));
  assert(state.includes('authorityConverged=false'));
});
