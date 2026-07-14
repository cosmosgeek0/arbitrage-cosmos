import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_ROLES,
  projectMachineGraphEvidence,
  validateMachineGraphEvidenceSnapshot,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  ASSEMBLED_AT_MS,
  OWNER_DIGEST,
  completeInput,
  counterWindow,
  makeRoleCurrent,
  observedMetric,
} from './fixtures.mjs';

test('rejects missing, duplicate, and out-of-order role evidence', () => {
  const missing = completeInput();
  missing.roles.pop();
  assert.throws(() => projectMachineGraphEvidence(missing), /every §22 role/);

  const duplicate = completeInput();
  duplicate.roles[1] = structuredClone(duplicate.roles[0]);
  assert.throws(() => projectMachineGraphEvidence(duplicate), /missing, duplicated, or out of order/);

  const swapped = completeInput();
  [swapped.roles[0], swapped.roles[1]] = [swapped.roles[1], swapped.roles[0]];
  assert.throws(() => projectMachineGraphEvidence(swapped), /missing, duplicated, or out of order/);
});

test('rejects hidden, duplicate, invented, and non-bound canonical component mappings', () => {
  const missingRole = completeInput();
  missingRole.roleBindings.pop();
  assert.throws(() => projectMachineGraphEvidence(missingRole), /declare every §22 role/);

  const duplicate = completeInput();
  const publicSpot = duplicate.roleBindings.find((entry) => entry.role === 'SPOT_PUBLIC_STREAM');
  const publicUsdm = duplicate.roleBindings.find((entry) => entry.role === 'USD_M_PUBLIC_STREAM');
  publicUsdm.componentIds = [...publicUsdm.componentIds, publicSpot.componentIds[0]];
  assert.throws(() => projectMachineGraphEvidence(duplicate), /more than once/);

  const invented = completeInput();
  invented.roleBindings.find((entry) => entry.bindingState === 'BOUND').componentIds[0] = 'shadow-supervisor';
  assert.throws(() => projectMachineGraphEvidence(invented), /non-canonical component ID/);

  const smuggled = completeInput();
  const missing = smuggled.roleBindings.find((entry) => entry.bindingState === 'MISSING');
  missing.componentIds = ['engine-supervisor'];
  assert.throws(() => projectMachineGraphEvidence(smuggled), /non-bound evidence cannot smuggle/);
});

test('rejects L12 subject drift, component revision drift, and synthetic promotion', () => {
  const realmDrift = completeInput();
  realmDrift.l12Snapshot = structuredClone(realmDrift.l12Snapshot);
  realmDrift.l12Snapshot.canonicalTruth.subject = {
    ...realmDrift.l12Snapshot.canonicalTruth.subject,
    accountRealmId: 'foreign-account-realm',
  };
  assert.throws(() => projectMachineGraphEvidence(realmDrift), /different (?:owner )?subject/);

  const revisionDrift = completeInput();
  revisionDrift.roles.find((entry) => entry.role === 'EXPOSURE_POSITION_SUPERVISOR').ownerRevision = 'foreign-revision';
  assert.throws(() => projectMachineGraphEvidence(revisionDrift), /copy the exact L12/);

  for (const evidenceState of ['CURRENT', 'PARTIAL', 'STALE']) {
    const promoted = completeInput();
    const role = promoted.roles.find((entry) => entry.role === 'EXPOSURE_POSITION_SUPERVISOR');
    role.evidenceState = evidenceState;
    role.sourceType = 'LIVE_PRIVATE';
    role.completeness = 'COMPLETE';
    assert.throws(
      () => projectMachineGraphEvidence(promoted),
      /must preserve its synthetic source classification|synthetic evidence cannot claim a live source/,
      evidenceState,
    );
  }
});

test('requires the full canonical L12 validator and rejects recovery revision drift', () => {
  const forgedRevision = completeInput();
  forgedRevision.l12Snapshot = structuredClone(forgedRevision.l12Snapshot);
  forgedRevision.l12Snapshot.snapshotRevision = 'l12_forged';
  assert.throws(() => projectMachineGraphEvidence(forgedRevision), /not reproducible/);

  const recoveryDrift = completeInput();
  recoveryDrift.l12Snapshot = structuredClone(recoveryDrift.l12Snapshot);
  recoveryDrift.l12Snapshot.recovery.ownerRevision = 'foreign-recovery-revision';
  assert.throws(() => projectMachineGraphEvidence(recoveryDrift), /canonical truth revisions diverge|not reproducible/);
});

test('rejects empty CURRENT evidence and synthetic evidence claiming a live source', () => {
  const empty = completeInput();
  const role = empty.roles.find((entry) => entry.role === 'SPOT_PUBLIC_STREAM');
  role.evidenceState = 'CURRENT';
  assert.throws(() => projectMachineGraphEvidence(empty), /requires an owner revision, source, and completeness/);

  const syntheticLive = completeInput();
  const synthetic = syntheticLive.roles.find((entry) => entry.role === 'SPOT_PUBLIC_STREAM');
  synthetic.evidenceState = 'SYNTHETIC_ONLY';
  synthetic.ownerRevision = 'synthetic-owner-revision-1';
  synthetic.sourceType = 'LIVE_PUBLIC';
  synthetic.completeness = 'COMPLETE';
  assert.throws(() => projectMachineGraphEvidence(syntheticLive), /synthetic evidence cannot claim a live source/);

  const missingCompleteness = completeInput();
  const current = makeRoleCurrent(missingCompleteness, 'SPOT_PUBLIC_STREAM');
  current.completeness = 'MISSING';
  assert.throws(() => projectMachineGraphEvidence(missingCompleteness), /CURRENT evidence cannot be empty or unknown/);
});

test('keeps per-role supported controls as a closed subset without false global association', () => {
  const unsupportedUnavailable = completeInput();
  unsupportedUnavailable.roles[0].supportedControls = ['SET_COMPONENT_DESIRED_STATE'];
  assert.throws(() => projectMachineGraphEvidence(unsupportedUnavailable), /unavailable evidence must not fabricate/);

  const duplicate = completeInput();
  const current = makeRoleCurrent(duplicate, 'SPOT_PUBLIC_STREAM');
  current.supportedControls = ['SET_COMPONENT_DESIRED_STATE', 'SET_COMPONENT_DESIRED_STATE'];
  assert.throws(() => projectMachineGraphEvidence(duplicate), /duplicate-free and canonically ordered/);

  const outOfOrder = completeInput();
  const ordered = makeRoleCurrent(outOfOrder, 'SPOT_PUBLIC_STREAM');
  ordered.supportedControls = ['SAFE_RESTART_COMPONENT', 'SET_COMPONENT_DESIRED_STATE'];
  assert.throws(() => projectMachineGraphEvidence(outOfOrder), /duplicate-free and canonically ordered/);
});

test('rejects exposure or attention truth on any role other than the L12 supervisor binding', () => {
  for (const field of ['capitalExposed', 'operatorAttentionRequired']) {
    const input = completeInput();
    input.roles.find((entry) => entry.role === 'CAPITAL_GATE')[field] = false;
    assert.throws(() => projectMachineGraphEvidence(input), /cannot duplicate L12 Capital exposure or attention truth/, field);
  }
});

test('requires exactly the two proven Foundation runtime mappings while every control remains unavailable', () => {
  const understated = completeInput();
  const control = understated.controls.find(
    (entry) => entry.action === 'SET_COMPONENT_DESIRED_STATE',
  );
  control.implementationState = 'CONTRACT_ONLY';
  assert.throws(() => projectMachineGraphEvidence(understated), /preserve exactly the narrow Foundation runtime mapping/);

  const overstated = completeInput();
  overstated.controls.find((entry) => entry.action === 'HALT').implementationState =
    'PROVEN_CONTROL_PLANE_RUNTIME_ONLY';
  assert.throws(() => projectMachineGraphEvidence(overstated), /preserve exactly the narrow Foundation runtime mapping/);

  const missingRevision = completeInput();
  missingRevision.controls.find(
    (entry) => entry.action === 'SAFE_RESTART_COMPONENT',
  ).ownerRevision = null;
  assert.throws(() => projectMachineGraphEvidence(missingRevision), /requires an owner revision/);

  const falselyAvailable = completeInput();
  falselyAvailable.controls[0].availability = 'AVAILABLE';
  assert.throws(() => projectMachineGraphEvidence(falselyAvailable), /unavailable and non-dispatching/);

  const routed = completeInput();
  routed.controls[0].controlReference = 'route-control-1';
  assert.throws(() => projectMachineGraphEvidence(routed), /unavailable and non-dispatching/);

  const missingAction = completeInput();
  missingAction.controls.pop();
  assert.throws(() => projectMachineGraphEvidence(missingAction), /every L14 action/);
});

test('keeps whole-machine state inside the Foundation control-state envelope', () => {
  const forgedAuthority = completeInput();
  const role = makeRoleCurrent(forgedAuthority, 'SPOT_PUBLIC_STREAM');
  role.controlState.authority = 'UNAVAILABLE';
  role.controlState.reasonCodes = ['FOUNDATION_CONTROL_STATE_UNAVAILABLE'];
  assert.throws(() => projectMachineGraphEvidence(forgedAuthority), /unavailable control evidence/);

  const missingDigest = completeInput();
  makeRoleCurrent(missingDigest, 'SPOT_PUBLIC_STREAM').controlState.ownerDigest = null;
  assert.throws(() => projectMachineGraphEvidence(missingDigest), /requires canonical states and owner provenance/);

  const invalidPhase = completeInput();
  makeRoleCurrent(invalidPhase, 'SPOT_PUBLIC_STREAM').controlState.phase = 'LIVE';
  assert.throws(() => projectMachineGraphEvidence(invalidPhase), /invalid canonical Foundation control state/);

  const misattributedRestartCount = completeInput();
  misattributedRestartCount.roles[0].controlState.restartCount = 0;
  assert.throws(() => projectMachineGraphEvidence(misattributedRestartCount), /exact closed schema/);
});

test('rejects metric unit, value-kind, range, absence, and dynamic-label false greens', () => {
  const revisionNumber = completeInput();
  observedMetric(revisionNumber, 'DEPLOYED_REVISION', 1);
  assert.throws(() => projectMachineGraphEvidence(revisionNumber), /bounded non-empty string/);

  const ageString = completeInput();
  observedMetric(ageString, 'PUBLIC_EVENT_AGE_MS', '1');
  assert.throws(() => projectMachineGraphEvidence(ageString), /safe integer/);

  const ppm = completeInput();
  observedMetric(ppm, 'CPU_UTILIZATION_PPM', 1_000_001);
  assert.throws(() => projectMachineGraphEvidence(ppm), /between 0 and 1000000/);

  const unknownZero = completeInput();
  unknownZero.metrics[0].value = 0;
  assert.throws(() => projectMachineGraphEvidence(unknownZero), /must not fabricate a zero or status/);

  const dynamicLabel = completeInput();
  dynamicLabel.metrics[0].labels = [{ accountRealmId: 'realm-binance-primary' }];
  assert.throws(() => projectMachineGraphEvidence(dynamicLabel), /closed empty low-cardinality set/);

  const wrongUnit = completeInput();
  wrongUnit.metrics[0].unit = 'COUNT';
  assert.throws(() => projectMachineGraphEvidence(wrongUnit), /identity, unit, or status is invalid/);

  for (const badRevision of ['revision-abc', 'A'.repeat(40), '1'.repeat(39)]) {
    const badSha = completeInput();
    observedMetric(badSha, 'DEPLOYED_REVISION', badRevision);
    assert.throws(() => projectMachineGraphEvidence(badSha), /lowercase 40- or 64-hex deployed SHA/);
  }

  const openStatus = completeInput();
  observedMetric(openStatus, 'BACKUP_HEALTH', 'UNKNOWN');
  assert.throws(() => projectMachineGraphEvidence(openStatus), /closed owner health status/);

  const unavailableOwner = completeInput();
  unavailableOwner.metrics[0].ownerRevision = 'invented-unavailable-owner-revision';
  assert.throws(() => projectMachineGraphEvidence(unavailableOwner), /only explicit null owner facts/);

  const gaugeWindow = completeInput();
  observedMetric(gaugeWindow, 'PUBLIC_EVENT_AGE_MS', 10, { window: counterWindow() });
  assert.throws(() => projectMachineGraphEvidence(gaugeWindow), /non-counter metric evidence cannot claim/);

  const counterWithoutWindow = completeInput();
  observedMetric(counterWithoutWindow, 'STREAM_RECONNECT_COUNT', 1, { window: null });
  assert.throws(() => projectMachineGraphEvidence(counterWithoutWindow), /counter evidence requires a counter window/);
});

test('rejects negative and non-canonical magnitude decimals for every exact-decimal metric', () => {
  for (const metric of ['UNHEDGED_NOTIONAL', 'MARGIN_LIABILITY', 'MARGIN_INTEREST']) {
    for (const invalid of ['-1', '-0', '01', '1.0', '1.', '.1']) {
      const input = completeInput();
      observedMetric(input, metric, invalid);
      assert.throws(
        () => projectMachineGraphEvidence(input),
        /canonical non-negative exact decimal/,
        `${metric}:${invalid}`,
      );
    }
  }
});

test('rejects malformed canonical Foundation RateDiagnostic state/nullability', () => {
  const staleRate = completeInput();
  const stale = makeRoleCurrent(staleRate, 'SPOT_PUBLIC_STREAM').inputRate;
  stale.diagnostic.state = 'STALE';
  stale.reasonCodes = ['FOUNDATION_RATE_STALE'];
  assert.throws(() => projectMachineGraphEvidence(staleRate), /non-KNOWN evidence cannot claim a rate/);

  const knownWithoutDelta = completeInput();
  makeRoleCurrent(knownWithoutDelta, 'SPOT_PUBLIC_STREAM').inputRate.diagnostic.deltaCount = null;
  assert.throws(() => projectMachineGraphEvidence(knownWithoutDelta), /KNOWN evidence requires a rate, delta/);

  const unknownWithWindow = completeInput();
  const unknown = makeRoleCurrent(unknownWithWindow, 'SPOT_PUBLIC_STREAM').inputRate;
  unknown.diagnostic = {
    state: 'UNKNOWN',
    perSecond: null,
    deltaCount: null,
    windowMs: 1_000,
    startAtMs: null,
    endAtMs: null,
    ageMs: null,
    maxAgeMs: 5_000,
  };
  unknown.logicalWriterId = null;
  unknown.aggregationTemporality = 'UNKNOWN';
  unknown.reasonCodes = ['FOUNDATION_RATE_UNKNOWN'];
  assert.throws(() => projectMachineGraphEvidence(unknownWithWindow), /UNKNOWN evidence must preserve canonical null rate facts/);

  const invalidWindow = completeInput();
  const invalid = makeRoleCurrent(invalidWindow, 'SPOT_PUBLIC_STREAM').inputRate;
  invalid.diagnostic.state = 'INVALID_WINDOW';
  invalid.diagnostic.perSecond = null;
  invalid.diagnostic.deltaCount = null;
  invalid.reasonCodes = ['FOUNDATION_RATE_INVALID_WINDOW'];
  assert.throws(() => projectMachineGraphEvidence(invalidWindow), /non-positive window/);
});

test('rejects forged Foundation rate arithmetic and contradictory freshness states', () => {
  const wrongWindow = completeInput();
  makeRoleCurrent(wrongWindow, 'SPOT_PUBLIC_STREAM').inputRate.diagnostic.windowMs = 999;
  assert.throws(() => projectMachineGraphEvidence(wrongWindow), /windowMs must equal/);

  const wrongAge = completeInput();
  makeRoleCurrent(wrongAge, 'SPOT_PUBLIC_STREAM').inputRate.diagnostic.ageMs = 9;
  assert.throws(() => projectMachineGraphEvidence(wrongAge), /ageMs must equal/);

  const wrongRate = completeInput();
  makeRoleCurrent(wrongRate, 'SPOT_PUBLIC_STREAM').inputRate.diagnostic.perSecond = 11;
  assert.throws(() => projectMachineGraphEvidence(wrongRate), /canonical Foundation rate formula/);

  const staleKnown = completeInput();
  makeRoleCurrent(staleKnown, 'SPOT_PUBLIC_STREAM').inputRate.diagnostic.maxAgeMs = 5;
  assert.throws(() => projectMachineGraphEvidence(staleKnown), /KNOWN evidence cannot exceed maxAgeMs/);

  const freshStale = completeInput();
  const stale = makeRoleCurrent(freshStale, 'SPOT_PUBLIC_STREAM').inputRate;
  stale.diagnostic.state = 'STALE';
  stale.diagnostic.perSecond = null;
  stale.reasonCodes = ['FOUNDATION_RATE_STALE'];
  assert.throws(() => projectMachineGraphEvidence(freshStale), /STALE evidence must exceed maxAgeMs/);

  const nonSkewedClock = completeInput();
  const clock = makeRoleCurrent(nonSkewedClock, 'SPOT_PUBLIC_STREAM').inputRate;
  clock.diagnostic.state = 'CLOCK_SKEWED';
  clock.diagnostic.perSecond = null;
  clock.diagnostic.deltaCount = null;
  clock.reasonCodes = ['FOUNDATION_RATE_CLOCK_SKEWED'];
  assert.throws(() => projectMachineGraphEvidence(nonSkewedClock), /requires negative ageMs/);
});

test('preserves owner-declared temporality without letting Foundation evidence change dialect', () => {
  const falseFoundationDelta = completeInput();
  makeRoleCurrent(falseFoundationDelta, 'SPOT_PUBLIC_STREAM').inputRate.aggregationTemporality = 'DELTA';
  assert.throws(() => projectMachineGraphEvidence(falseFoundationDelta), /must preserve cumulative-counter temporality/);

  const ownerDelta = completeInput();
  const ownerRate = makeRoleCurrent(ownerDelta, 'SPOT_PUBLIC_STREAM').inputRate;
  ownerRate.authority = 'OWNER_INJECTED';
  ownerRate.aggregationTemporality = 'DELTA';
  ownerRate.ownerRevision = 'owner-rate-revision-1';
  assert.equal(
    projectMachineGraphEvidence(ownerDelta).roles.find((entry) => entry.role === 'SPOT_PUBLIC_STREAM')
      .inputRate.aggregationTemporality,
    'DELTA',
  );

  const invalid = completeInput();
  makeRoleCurrent(invalid, 'SPOT_PUBLIC_STREAM').inputRate.aggregationTemporality = 'INFERRED';
  assert.throws(() => projectMachineGraphEvidence(invalid), /temporality or authority is invalid/);
});

test('accepts every canonical non-known rate diagnostic only without a projected rate', () => {
  const cases = [
    {
      state: 'UNKNOWN',
      perSecond: null,
      deltaCount: null,
      windowMs: null,
      startAtMs: null,
      endAtMs: null,
      ageMs: null,
      maxAgeMs: 5_000,
    },
    {
      state: 'COUNTER_RESET',
      perSecond: null,
      deltaCount: null,
      windowMs: 1_000,
      startAtMs: ASSEMBLED_AT_MS - 1_010,
      endAtMs: ASSEMBLED_AT_MS - 10,
      ageMs: 10,
      maxAgeMs: 5_000,
    },
    {
      state: 'STALE',
      perSecond: null,
      deltaCount: 10,
      windowMs: 1_000,
      startAtMs: ASSEMBLED_AT_MS - 10_010,
      endAtMs: ASSEMBLED_AT_MS - 9_010,
      ageMs: 9_010,
      maxAgeMs: 5_000,
    },
    {
      state: 'INVALID_WINDOW',
      perSecond: null,
      deltaCount: null,
      windowMs: 0,
      startAtMs: ASSEMBLED_AT_MS - 10,
      endAtMs: ASSEMBLED_AT_MS - 10,
      ageMs: 10,
      maxAgeMs: 5_000,
    },
    {
      state: 'CLOCK_SKEWED',
      perSecond: null,
      deltaCount: null,
      windowMs: 1_000,
      startAtMs: ASSEMBLED_AT_MS - 500,
      endAtMs: ASSEMBLED_AT_MS + 500,
      ageMs: -500,
      maxAgeMs: 5_000,
    },
  ];
  for (const diagnostic of cases) {
    const input = completeInput();
    const rate = makeRoleCurrent(input, 'SPOT_PUBLIC_STREAM').inputRate;
    rate.diagnostic = diagnostic;
    rate.reasonCodes = [`FOUNDATION_RATE_${diagnostic.state}`];
    if (diagnostic.state === 'UNKNOWN') {
      rate.logicalWriterId = null;
      rate.aggregationTemporality = 'UNKNOWN';
    }
    assert.doesNotThrow(() => projectMachineGraphEvidence(input), diagnostic.state);
  }

  const unavailableWithFacts = completeInput();
  unavailableWithFacts.roles[0].inputRate.ownerRevision = 'forged-rate-owner';
  assert.throws(() => projectMachineGraphEvidence(unavailableWithFacts), /only explicit null facts/);
});

test('applies counter monotonicity to metric windows only for contiguous cumulative evidence', () => {
  const decreasing = completeInput();
  observedMetric(decreasing, 'PROCESS_RESTART_COUNT', 2, {
    window: counterWindow({ startCount: 20, endCount: 10 }),
  });
  assert.throws(() => projectMachineGraphEvidence(decreasing), /contiguous counter evidence cannot decrease/);

  for (const overrides of [
    { continuity: 'RESET', startCount: 20, endCount: 10 },
    { aggregationTemporality: 'DELTA', startCount: 20, endCount: 10 },
  ]) {
    const input = completeInput();
    observedMetric(input, 'PROCESS_RESTART_COUNT', 2, { window: counterWindow(overrides) });
    assert.doesNotThrow(() => projectMachineGraphEvidence(input));
  }
});

test('rejects alarm automation, liquidation, capital mutation, and non-alarm HALT recommendations', () => {
  for (const [field, value] of [
    ['automaticAction', 'HALT'],
    ['canLiquidate', true],
    ['canMutateCapital', true],
  ]) {
    const input = completeInput();
    input.alarms[0][field] = value;
    assert.throws(() => projectMachineGraphEvidence(input), /non-action boundary is invalid/, field);
  }

  const haltWithoutAlarm = completeInput();
  haltWithoutAlarm.alarms[0].haltRecommendation = true;
  assert.throws(() => projectMachineGraphEvidence(haltWithoutAlarm), /recommend HALT only/);

  const alarmWithoutOwner = completeInput();
  alarmWithoutOwner.alarms[0] = {
    ...alarmWithoutOwner.alarms[0],
    state: 'ALARM',
    reasonCodes: ['PROCESS_NOT_OBSERVED'],
  };
  assert.throws(() => projectMachineGraphEvidence(alarmWithoutOwner), /requires owner revision, digest, and time/);
});

test('binds metric windows to their observation time', () => {
  const impossible = completeInput();
  observedMetric(impossible, 'PROCESS_RESTART_COUNT', 2, {
    observedAtMs: ASSEMBLED_AT_MS - 100,
    window: counterWindow({ endAtMs: ASSEMBLED_AT_MS - 10 }),
  });
  assert.throws(() => projectMachineGraphEvidence(impossible), /window cannot end after its observation time/);
});

test('rejects extra, sparse, inherited, accessor, symbol, oversized, and secret-bearing data', () => {
  const extra = completeInput();
  extra.shadowReadiness = true;
  assert.throws(() => projectMachineGraphEvidence(extra), /exact closed schema/);

  const sparse = completeInput();
  delete sparse.roles[3];
  assert.throws(() => projectMachineGraphEvidence(sparse), /must not be sparse/);

  const inherited = completeInput();
  inherited.metrics[0] = Object.create(inherited.metrics[0]);
  assert.throws(() => projectMachineGraphEvidence(inherited), /plain objects/);

  const accessor = completeInput();
  Object.defineProperty(accessor, 'assembledAtMs', {
    enumerable: true,
    get() { throw new Error('must not execute'); },
  });
  assert.throws(() => projectMachineGraphEvidence(accessor), /forbids accessors/);

  const symbol = completeInput();
  symbol[Symbol('hidden')] = true;
  assert.throws(() => projectMachineGraphEvidence(symbol), /symbol fields/);

  const oversized = completeInput();
  oversized.metrics[0].reasonCodes = Array.from({ length: 65 }, (_, index) => `CODE_${index}`);
  assert.throws(() => projectMachineGraphEvidence(oversized), /bounded non-empty reason-code array/);

  const sensitive = completeInput();
  sensitive.metrics[0].apiSecret = 'not-a-real-secret';
  assert.throws(() => projectMachineGraphEvidence(sensitive), /forbids sensitive field/);

  for (const field of [
    'apiSecret', 'clientSecret', 'authorization', 'bearerToken', 'token', 'passphrase',
    'listenKey', 'sessionKey', 'accessKey',
  ]) {
    const input = completeInput();
    input.roles[0][field] = 'documentary-placeholder';
    assert.throws(() => projectMachineGraphEvidence(input), /forbids sensitive field/, field);
  }

  for (const secretValue of [
    '-----BEGIN PRIVATE KEY----- definitely-not-real -----END PRIVATE KEY-----',
    'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop',
    'AKIAABCDEFGHIJKLMNOP',
    'authorization: bearer abcdefghijklmnop',
    'X-MBX-APIKEY: abcdefghijklmnop',
    'api_key=abcdefghijklmnop',
    'api_secret=abcdefghijklmnop',
    'client_secret=abcdefghijklmnop',
    'secret_access_key=abcdefghijklmnop',
    'access_token=abcdefghijklmnop',
  ]) {
    const input = completeInput();
    input.roles[0].owner = secretValue;
    assert.throws(() => projectMachineGraphEvidence(input), /secret-shaped string values/, secretValue);
  }

  const oversizedString = completeInput();
  oversizedString.roles[0].owner = 'x'.repeat(16_385);
  assert.throws(() => projectMachineGraphEvidence(oversizedString), /oversized string/);

  const oversizedProperty = completeInput();
  oversizedProperty.roles[0]['x'.repeat(257)] = true;
  assert.throws(() => projectMachineGraphEvidence(oversizedProperty), /oversized property name/);

  const aggregateStrings = completeInput();
  for (const role of aggregateStrings.roles) role.owner = 'r'.repeat(16_000);
  for (const metric of aggregateStrings.metrics) metric.owner = 'm'.repeat(16_000);
  for (const alarm of aggregateStrings.alarms) alarm.owner = 'a'.repeat(16_000);
  assert.throws(() => projectMachineGraphEvidence(aggregateStrings), /aggregate string bound/);
});

test('rejects metric or alarm identity drift and reproducibility tampering', () => {
  const metricDrift = completeInput();
  metricDrift.metrics[0].metric = MACHINE_GRAPH_METRICS[1];
  assert.throws(() => projectMachineGraphEvidence(metricDrift), /identity, unit, or status is invalid/);

  const alarmDrift = completeInput();
  alarmDrift.alarms[0].alarm = MACHINE_GRAPH_ALARMS[1];
  assert.throws(() => projectMachineGraphEvidence(alarmDrift), /identity, state, or non-action boundary is invalid/);

  const sourceInput = completeInput();
  const snapshot = structuredClone(projectMachineGraphEvidence(sourceInput));
  snapshot.snapshotRevision = 'l13_forged';
  assert.throws(() => validateMachineGraphEvidenceSnapshot(snapshot, sourceInput.l12Snapshot), /not reproducible/);
});

test('accepts fully typed status, exact decimal, and signed server-offset evidence', () => {
  const input = completeInput();
  observedMetric(input, 'BACKUP_HEALTH', 'DEGRADED');
  observedMetric(input, 'UNHEDGED_NOTIONAL', '0');
  observedMetric(input, 'SERVER_TIME_OFFSET_MS', -25);
  observedMetric(input, 'PROCESS_RESTART_COUNT', 0, {
    window: counterWindow({ startCount: 0, endCount: 0 }),
  });
  assert.doesNotThrow(() => projectMachineGraphEvidence(input));
});
