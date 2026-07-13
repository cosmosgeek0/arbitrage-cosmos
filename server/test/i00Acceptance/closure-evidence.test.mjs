import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { discoverOperationalPageIds, evaluateLoadShedding, measureResourceHarness, readJson, readText, ROOT, sha256 } from './harness.mjs';
import { buildMachineEvidence, evidenceDigest, renderReports } from '../../../test/i00/render-reports.mjs';
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

test('mission coverage rows are complete unique and fixture-safe', () => {
  const ids = new Set();
  for (const row of closure.requirements) {
    assert(!ids.has(row.id), `duplicate ${row.id}`);
    ids.add(row.id);
    for (const field of ['source', 'requirement', 'owner', 'code', 'runtime', 'persistence', 'api', 'cockpit', 'control', 'test', 'scenario', 'status', 'replacement']) {
      assert.equal(typeof row[field], 'string', `${row.id}.${field}`);
      assert(row[field].length > 0, `${row.id}.${field}`);
    }
    assert(STATUS.has(row.status), `${row.id}.status=${row.status}`);
    assert(!['WIRED', 'VISIBLE', 'DEPLOYED_PROVED', 'LIVE_OBSERVED'].includes(row.status), `${row.id} fixture false-green`);
    if (row.sha !== null) assert(/^[a-f0-9]{40}$/.test(row.sha), `${row.id}.sha`);
    if (row.status !== 'LOCAL_PROVED' && row.blocker === null) throw new Error(`${row.id} missing blocker`);
  }
  assert(ids.has('SAFE-05'));
  assert(ids.has('DASH-10'));
  assert(ids.has('PROTO-01'));
  assert(ids.has('Q-CLOSURE-01'));
  assert(ids.has('L-CLOSURE-01'));
  for (const id of BINDING_CATEGORY_IDS) assert(ids.has(id), `missing binding category ${id}`);
});

test('accepted evidence references full SHAs and existing receipts', () => {
  const provenance = readJson('fixtures/i00/receipt-provenance.json');
  const verified = verifyReceiptProvenance(provenance);
  assert.equal(verified.passed, true, JSON.stringify(verified.results.filter((result) => !result.passed)));
  assert.equal(provenance.items.length, closure.acceptedEvidence.length);
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
  const terminalClasses = new Set(['MOVED_TO_AUTHENTICATED_CONTROL', 'INTENTIONALLY_OWNER_RUNBOOK', 'EXTERNAL_OWNER_ACTION', 'DEFECT', 'NOT_SUPPORTED']);
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

test('page capability and control matrices stay machine-checkable and synthetic', () => {
  assert.equal(catalog.pages.length, 19);
  assert.deepEqual(catalog.pages.map((row) => row.pageId).sort(), discoverOperationalPageIds());
  assert.equal(catalog.capabilities.length, 10);
  assert.equal(catalog.controls.length, 14);
  assert(catalog.capabilities.every((row) => row.fixtureState === 'SYNTHETIC_ONLY'));
  assert(catalog.pages.every((row) => row.blocker && row.errorBehavior));
  assert(catalog.pages.every((row) => ['SYNTHETIC_ONLY', 'NOT_CONFIGURED', 'BASE_REALITY_UNVERIFIED'].includes(row.fixtureState)));
  assert(catalog.controls.every((row) => row.bounded === true && row.moneyIncreasing === false));
  const controlFields = [
    'id', 'command', 'group', 'label', 'explanation', 'owner', 'targetTypes', 'payloadSchema', 'safeBounds', 'defaultValue',
    'semantics', 'effect', 'requiredPosture', 'confirmation', 'expiryMs', 'reversible', 'previewProvider', 'invariants', 'telemetry', 'wiringState',
  ];
  for (const control of catalog.controls) {
    for (const field of controlFields) assert.notEqual(control[field], undefined, `${control.id}.${field}`);
    assert(control.wiringState === 'WIRED_FIXTURE' || control.wiringState === 'OWNER_GATED'
      || control.wiringState.startsWith('PENDING_BACKEND:') || control.wiringState.startsWith('UNAVAILABLE:'));
  }
  assert.equal(catalog.requiredAbsentSurfaces.length, 1);
  assert.deepEqual(catalog.requiredAbsentSurfaces[0], {
    surface: 'Control Room',
    source: 'I00#15',
    state: 'MISSING',
    blocker: 'DIRECTOR_MOUNT_REQUIRED; FINAL_RUNTIME_ENDPOINTS_REQUIRED; CANONICAL_COMMAND_PERSISTENCE_REQUIRED',
    requiredEvidence: 'real machine graph, registry search, preview-confirm-result, before/after receipt readback',
  });
});

test('generated Markdown reports are byte-identical to machine evidence rendering', () => {
  const reports = renderReports({ ...closure, generatedAtUtc: '2026-07-13T00:00:00Z' });
  for (const [relativePath, expected] of Object.entries(reports)) {
    assert.equal(readFileSync(path.join(ROOT, relativePath), 'utf8'), expected, relativePath);
  }
});

test('machine report is canonical and self-digesting', () => {
  const actual = JSON.parse(readFileSync(path.join(ROOT, 'integration/reports/i00-proof-evidence.json'), 'utf8'));
  const expected = buildMachineEvidence();
  assert.deepEqual({ ...actual, evidenceSha256: undefined }, { ...expected, evidenceSha256: undefined });
  assert.equal(actual.evidenceSha256, evidenceDigest(expected));
  assert.equal(actual.targetState, 'PROOF_PRESTAGE_READY');
  assert.equal(actual.productVerdict, 'AWAITING_REAL_ADAPTERS');
  assert(actual.frozenInputs.every((input) => input.passed));
  assert.equal(actual.historicalFrozenInputs.filter((input) => input.passed).length, 12);
  assert.deepEqual(actual.historicalFrozenInputs.filter((input) => !input.passed).map((input) => input.path), [
    'QL_DIRECTOR_STATE.md',
    'QL_PARALLEL_DAG.md',
  ]);
  assert.equal(actual.livingDirectorInputAcceptance.passed, true);
  assert.equal(actual.livingDirectorInputAcceptance.ruling, 'D-LAUNCH-7');
  assert.equal(actual.livingDirectorInputAcceptance.mode, 'LATEST_CURRENT_MAIN_TOUCH');
  assert.equal(actual.livingDirectorInputAcceptance.directiveResults.length, 5);
  assert(actual.authority.scanPassed);
  assert.equal(actual.authority.authorityConverged, false);
  assert(actual.authority.unresolvedConflictCount > 0);
  assert(actual.receiptProvenanceVerification.passed);
  assert(actual.routes.every((route) => route.observed));
});

test('ready seal records implementation identity receipt hashes and exact next integration command', () => {
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
